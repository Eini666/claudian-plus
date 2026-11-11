/**
 * Klient bota Telegrama dla Claudian Plus: long polling, parowanie czatu, wysylka tekstu i glosowek.
 * Port `JARVIS/server/telegram.js`. Polaczenie wychodzi z komputera, wiec zaden port nie jest otwierany.
 *
 * Jedyna bariera dostepu do vaulta to sparowany `chat_id` (D6) — sprawdzany przy KAZDEJ wiadomosci.
 * Komunikaty bledow nigdy nie zawieraja adresu API, bo w sciezce siedzi token.
 */

import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

import { czytajSekrety, plikBlokadyMostu, type SekretyTelegrama, zapiszSekrety } from './plusHome';

export const TEKST_PO_PAROWANIU = 'Połączono z Claudian Plus. Napisz „wychodzę”, żeby dostawać głosówki.';
export const TEKST_BEZ_TRANSKRYPCJI = 'Głosówek jeszcze nie rozumiem — napisz tekstem.';
export const TEKST_BLAD_GLOSOWKI = 'Nie udało się rozpoznać głosówki — spróbuj jeszcze raz albo napisz tekstem.';

const API = 'https://api.telegram.org';
const CZEKANIE_S = 50; // long polling: zadanie wisi do 50 s i wraca z wiadomoscia
const LIMIT_ZNAKOW = 4000; // Telegram tnie na 4096
const LIMIT_PODPISU = 1024; // dluzszy caption Telegram odrzuca
const ODNOWA_BLOKADY_MS = 30_000;
const BLOKADA_WAZNA_MS = 90_000;
const MAX_ODSTEP_MS = 60_000;

export interface MetaWiadomosci {
  zGlosu: boolean;
  /** Czas nadania, nie odbioru. */
  kiedy: Date;
}

export interface ObslugaTelegrama {
  /** Zwraca odpowiedz do odeslania albo `null`, gdy nie ma czego wyslac. */
  obsluz(tekst: string, meta: MetaWiadomosci): Promise<string | null>;
  transkrybuj?: (bajty: Buffer) => Promise<string | null>;
}

export interface OpcjeKlienta {
  home?: string;
  fetch?: typeof fetch;
  /** Pobranie bajtow pliku spod adresu; domyslnie Node `https`. */
  pobierz?: (url: string) => Promise<Buffer>;
  log?: (komunikat: string) => void;
}

/**
 * Host plikow Telegrama przy prawdziwym pliku (200) NIE wysyla naglowkow CORS (API i 404 — tak),
 * wiec `fetch` z okna Obsidiana jest blokowany. Node `https` CORS nie podlega (zmierzone 08.11).
 * Bledy bez adresu — w sciezce jest token.
 */
function pobierzHttps(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30_000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`pobranie pliku z Telegrama: ${res.statusCode ?? 'brak statusu'}`));
        return;
      }
      const kawalki: Buffer[] = [];
      res.on('data', (k: Buffer) => kawalki.push(k));
      res.on('end', () => resolve(Buffer.concat(kawalki)));
      res.on('error', () => reject(new Error('pobranie pliku z Telegrama: przerwane')));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => reject(new Error('pobranie pliku z Telegrama: brak połączenia')));
  });
}

export type WynikStartu = 'dziala' | 'brak-tokenu' | 'zajete';
export type WynikParowania = 'sparowano' | 'czas-minal' | 'przerwano';

interface Plik { file_id: string; duration?: number }
interface Wiadomosc { chat: { id: number; type?: string }; date?: number; text?: string; voice?: Plik; audio?: Plik }
interface Aktualizacja { update_id: number; message?: Wiadomosc }

/** Dzieli dluga odpowiedz na granicy zdania; bez kropek tnie twardo na limicie. */
export function podziel(tekst: string, limit = LIMIT_ZNAKOW): string[] {
  const kawalki: string[] = [];
  let reszta = tekst.trim();
  while (reszta.length > limit) {
    const okno = reszta.slice(0, limit);
    const ciecie = Math.max(okno.lastIndexOf('. '), okno.lastIndexOf('\n'));
    const gdzie = ciecie > limit * 0.5 ? ciecie + 1 : limit;
    kawalki.push(reszta.slice(0, gdzie).trim());
    reszta = reszta.slice(gdzie).trim();
  }
  if (reszta) kawalki.push(reszta);
  return kawalki;
}

export class TelegramClient {
  private readonly home?: string;
  private readonly fetchFn: typeof fetch;
  private readonly pobierz: (url: string) => Promise<Buffer>;
  private readonly log: (komunikat: string) => void;
  private readonly wlasciciel = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  private sekrety: SekretyTelegrama | null = null;
  private stop$: AbortController | null = null;
  private odnowa: number | null = null;
  private offset = 0;
  private parowanie: ((wynik: WynikParowania) => void) | null = null;
  private parowanieOd: { kod: string; od: number } | null = null;

  constructor(opcje: OpcjeKlienta = {}) {
    this.home = opcje.home;
    this.fetchFn = opcje.fetch ?? ((input, init) => fetch(input, init));
    this.pobierz = opcje.pobierz ?? pobierzHttps;
    this.log = opcje.log ?? ((k) => console.warn(`[telegram] ${k}`));
  }

  get dziala(): boolean { return this.stop$ !== null; }

  start(obsluga: ObslugaTelegrama): WynikStartu {
    if (this.stop$) return 'dziala';
    this.sekrety = czytajSekrety(this.home);
    if (!this.sekrety) return 'brak-tokenu';
    if (!this.zajmijBlokade()) return 'zajete';
    const stop$ = (this.stop$ = new AbortController());
    this.odnowa = window.setInterval(() => { if (!this.zajmijBlokade()) this.stop(); }, ODNOWA_BLOKADY_MS);
    void this.petla(obsluga, stop$.signal);
    return 'dziala';
  }

  stop(): void {
    if (!this.stop$) return;
    this.stop$.abort();
    this.stop$ = null;
    if (this.odnowa !== null) window.clearInterval(this.odnowa);
    this.odnowa = null;
    this.parowanie?.('przerwano');
    if (this.czytajBlokade()?.wlasciciel === this.wlasciciel) fs.rmSync(plikBlokadyMostu(this.home), { force: true });
  }

  /**
   * Sparowanym czatem zostaje pierwsza prywatna wiadomosc z `kod` (pokazanym w ustawieniach),
   * wyslana po starcie parowania. Bez kodu bota przejmowal ktokolwiek pierwszy napisal — takze
   * zalegla wiadomosc sprzed klikniecia. Wymaga dzialajacego `start()`.
   */
  rozpocznijParowanie(sekundy: number, kod: string): Promise<WynikParowania> {
    if (!this.stop$) return Promise.reject(new Error('Nasłuch Telegrama nie działa'));
    this.parowanie?.('przerwano');
    // margines 5 s na roznice zegarow z serwerem Telegrama
    this.parowanieOd = { kod, od: Math.floor(Date.now() / 1000) - 5 };
    return new Promise((resolve) => {
      const zegar = window.setTimeout(() => zakoncz('czas-minal'), sekundy * 1000);
      const zakoncz = (wynik: WynikParowania) => {
        window.clearTimeout(zegar);
        if (this.parowanie === zakoncz) this.parowanie = null;
        resolve(wynik);
      };
      this.parowanie = zakoncz;
    });
  }

  async wyslijTekst(tekst: string, chatId = this.wymagajSekretow().chatId): Promise<void> {
    if (chatId === null) throw new Error('Telegram: czat nie jest sparowany');
    for (const kawalek of podziel(tekst)) await this.wolaj('sendMessage', { chat_id: chatId, text: kawalek });
  }

  /** Glosowka OGG/Opus; podpis ponad 1024 znaki jest pomijany (tekst idzie wtedy osobno, jesli trzeba). */
  async wyslijGlos(oggPath: string, podpis?: string): Promise<void> {
    const { chatId } = this.wymagajSekretow();
    if (chatId === null) throw new Error('Telegram: czat nie jest sparowany');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', new Blob([fs.readFileSync(oggPath)], { type: 'audio/ogg' }), path.basename(oggPath));
    if (podpis && podpis.length <= LIMIT_PODPISU) form.append('caption', podpis);
    await this.wolaj('sendVoice', form);
  }

  /** Dwa kroki: `getFile` po sciezke, potem bajty z hosta plikow. */
  async pobierzPlik(fileId: string): Promise<Buffer> {
    const { file_path: sciezka } = await this.wolaj<{ file_path?: unknown }>('getFile', { file_id: fileId });
    if (typeof sciezka !== 'string') throw new Error('Telegram getFile: brak ścieżki pliku');
    return this.pobierz(`${API}/file/bot${this.wymagajSekretow().token}/${sciezka}`);
  }

  private async petla(obsluga: ObslugaTelegrama, stop: AbortSignal): Promise<void> {
    let odstep = 0;
    while (!stop.aborted) {
      try {
        const aktualizacje = await this.wolaj<Aktualizacja[]>(
          'getUpdates', { timeout: CZEKANIE_S, offset: this.offset }, stop,
        );
        odstep = 0;
        for (const u of aktualizacje) {
          this.offset = u.update_id + 1;
          if (u.message?.chat) await this.przetworz(u.message, obsluga);
        }
      } catch (e) {
        if (stop.aborted) return;
        odstep = Math.min(odstep ? odstep * 2 : 1000, MAX_ODSTEP_MS);
        this.log(`przerwa w nasłuchu (${odstep / 1000} s): ${(e as Error).message}`);
        await new Promise<void>((r) => {
          const t = window.setTimeout(r, odstep);
          stop.addEventListener('abort', () => { window.clearTimeout(t); r(); }, { once: true });
        });
      }
    }
  }

  private async przetworz(w: Wiadomosc, obsluga: ObslugaTelegrama): Promise<void> {
    const sekrety = this.wymagajSekretow();
    try {
      const p = this.parowanieOd;
      if (this.parowanie && p && w.chat.type === 'private'
        && w.text?.trim() === p.kod && (w.date ?? 0) >= p.od) {
        zapiszSekrety({ token: sekrety.token, chatId: w.chat.id }, this.home);
        sekrety.chatId = w.chat.id;
        await this.wyslijTekst(TEKST_PO_PAROWANIU, w.chat.id);
        this.parowanie?.('sparowano');
        return;
      }
      // Jedyna bariera dostepu. Obcy czat dostaje cisze — sprawdzane PRZED pobraniem pliku.
      if (sekrety.chatId === null || w.chat.id !== sekrety.chatId) return;

      const glos = w.voice ?? w.audio;
      let tekst = w.text?.trim();
      if (!tekst) {
        if (!glos) return;
        if (!obsluga.transkrybuj) return await this.wyslijTekst(TEKST_BEZ_TRANSKRYPCJI);
        // Pusta transkrypcja tez idzie do `obsluz` — router odpowiada, ze nic nie uslyszal.
        try {
          tekst = (await obsluga.transkrybuj(await this.pobierzPlik(glos.file_id)))?.trim() ?? '';
        } catch (e) {
          this.log(`błąd głosówki: ${(e as Error).message}`);
          return await this.wyslijTekst(TEKST_BLAD_GLOSOWKI);
        }
      }
      const odpowiedz = await obsluga.obsluz(tekst, { zGlosu: Boolean(glos), kiedy: new Date((w.date ?? 0) * 1000) });
      if (odpowiedz?.trim()) await this.wyslijTekst(odpowiedz);
    } catch (e) {
      this.log(`błąd obsługi wiadomości: ${(e as Error).message}`);
    }
  }

  private async wolaj<T>(metoda: string, dane: Record<string, unknown> | FormData, stop?: AbortSignal): Promise<T> {
    const limit = AbortSignal.timeout((CZEKANIE_S + 15) * 1000); // dluzszy niz long polling
    // Zadnych wlasnych naglowkow: api.telegram.org odpowiada 501 na preflight OPTIONS, wiec w oknie
    // Obsidiana przechodza tylko "proste" zapytania — formularz urlencoded albo multipart (FormData).
    const body = dane instanceof FormData ? dane : new URLSearchParams(
      Object.entries(dane).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
    );
    let j: { ok?: boolean; result?: T; description?: string };
    try {
      const r = await this.fetchFn(`${API}/bot${this.wymagajSekretow().token}/${metoda}`, {
        method: 'POST',
        body,
        signal: stop ? AbortSignal.any([stop, limit]) : limit,
      });
      j = (await r.json()) as typeof j;
    } catch {
      // Blad fetch potrafi nesc URL z tokenem (takze w `cause`) — nie przepuszczamy go dalej.
      throw new Error(`Telegram ${metoda}: brak połączenia`);
    }
    if (!j.ok) throw new Error(`Telegram ${metoda}: ${j.description ?? 'błąd API'}`);
    return j.result as T;
  }

  private wymagajSekretow(): SekretyTelegrama {
    this.sekrety ??= czytajSekrety(this.home);
    if (!this.sekrety) throw new Error('Telegram: brak tokenu bota');
    return this.sekrety;
  }

  private czytajBlokade(): { wlasciciel?: string; ts?: number } | null {
    try {
      return JSON.parse(fs.readFileSync(plikBlokadyMostu(this.home), 'utf8')) as { wlasciciel?: string; ts?: number };
    } catch {
      return null;
    }
  }

  /** D7: jeden nasluch na bota. Zywa blokada innego wlasciciela = nie odpytujemy; przeterminowana = przejmujemy. */
  private zajmijBlokade(): boolean {
    const b = this.czytajBlokade();
    const obca = b && b.wlasciciel !== this.wlasciciel && Date.now() - (b.ts ?? 0) < BLOKADA_WAZNA_MS;
    if (obca) return false;
    // shortcut: odczyt+zapis nie jest atomowy; dwa okna startujace w tej samej ms moga oba wygrac — wtedy getUpdates zwroci 409 jednemu
    const plik = plikBlokadyMostu(this.home);
    fs.mkdirSync(path.dirname(plik), { recursive: true });
    fs.writeFileSync(plik, JSON.stringify({ pid: process.pid, wlasciciel: this.wlasciciel, ts: Date.now() }));
    return true;
  }
}
