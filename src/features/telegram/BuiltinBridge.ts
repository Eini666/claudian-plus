/**
 * Most wbudowany: wlasny bot Telegrama zamiast zewnetrznego programu (JARVIS). Wlacza sie tylko
 * w trybie `builtin` z wlaczonym mostem; folder i nazwa sa czytane przy kazdej wiadomosci,
 * wiec ich zmiana w ustawieniach nie wymaga restartu klienta.
 */

import { resolveAssistantName } from '../../core/types/settings';
import { folderMostu, type MostTelegrama } from '../chat/services/ariTelefon';
import { obsluzWiadomosc, tekstyMostu } from './bridgeRouter';
import { transkrybuj } from './speechToText';
import { type OpcjeKlienta, TelegramClient, type WynikStartu } from './TelegramClient';
import { MODELE_MOWY, type NazwaModeluMowy } from './voiceCatalog';
import { instrukcjaGlosowek } from './voiceInstructions';
import { przetworzGlosowki } from './voiceOutbox';
import { stan, syntezuj } from './voiceTools';

export interface UstawieniaMostu extends MostTelegrama {
  assistantName?: unknown;
  voiceName?: unknown;
  whisperModel?: unknown;
}

const CO_ILE_SKRZYNKA_MS = 3000;
const CO_ILE_PONOWIENIE_MS = 30_000;

export class BuiltinBridge {
  /** Klient dla wysylki glosowek i parowania (IU-5/IU-6); dziala tylko, gdy `klient.dziala`. */
  readonly klient: TelegramClient;
  private readonly home?: string;

  private skrzynka: number | null = null;
  private skrzynkaPracuje = false;
  private ponowienie: number | null = null;
  /** Czy dzialajacy klient dostal `transkrybuj`; klient czyta obsluge tylko przy starcie. */
  private zMowa = false;

  constructor(private readonly settings: () => UstawieniaMostu, opcje: OpcjeKlienta = {}) {
    this.home = opcje.home;
    this.klient = new TelegramClient(opcje);
  }

  /** Woluj po starcie wtyczki i po kazdym zapisie ustawien; stan sam dopasowuje sie do ustawien. */
  odswiez(): WynikStartu | 'wylaczony' {
    const s = this.settings();
    if (s.telegramBridgeEnabled !== true || s.telegramBridgeMode !== 'builtin') {
      this.stop();
      return 'wylaczony';
    }
    // Wywolywane tez po instalacji z panelu i po zmianie modelu — wtedy restart z nowa obsluga
    const mowa = this.mowaGotowa();
    if (mowa !== this.zMowa) this.klient.stop();
    this.zMowa = mowa;
    const wynik = this.klient.start({
      obsluz: async (tekst, { zGlosu, kiedy }) => this.obsluz(tekst, kiedy, zGlosu),
      // Model czytany przy kazdej glosowce
      transkrybuj: mowa ? (bajty) => transkrybuj(bajty, String(this.settings().whisperModel), this.home) : undefined,
    });
    if (wynik === 'dziala') this.skrzynka ??= window.setInterval(() => void this.oproznijSkrzynke(), CO_ILE_SKRZYNKA_MS);
    else this.zatrzymajSkrzynke();
    // Ctrl+R przeladowuje okno bez onunload — blokada starej instancji jest jeszcze swieza.
    // Bez ponowienia bot milczal do recznego przelaczenia mostu (test na zywo 08.11).
    if (wynik === 'zajete') this.ponowienie ??= window.setTimeout(() => { this.ponowienie = null; this.odswiez(); }, CO_ILE_PONOWIENIE_MS);
    return wynik;
  }

  stop(): void {
    if (this.ponowienie !== null) window.clearTimeout(this.ponowienie);
    this.ponowienie = null;
    this.zatrzymajSkrzynke();
    this.klient.stop();
  }

  /** Sekcja promptu systemowego dla Claude; tylko gdy glosowki naprawde moga wyjsc. */
  instrukcjaGlosowek(): string | null {
    return this.klient.dziala ? instrukcjaGlosowek(this.settings(), this.home) : null;
  }

  /** Jeden przebieg skrzynki glosowek; przebiegi sie nie nakladaja (synteza trwa dluzej niz odstep). */
  async oproznijSkrzynke(): Promise<void> {
    const dir = folderMostu(this.settings(), this.home);
    if (this.skrzynkaPracuje || !dir || !this.klient.dziala) return;
    this.skrzynkaPracuje = true;
    try {
      const glos = this.settings().voiceName;
      await przetworzGlosowki(dir, {
        syntezuj: (tekst) => syntezuj(tekst, typeof glos === 'string' ? glos : '', this.home),
        wyslijGlos: (ogg, podpis) => this.klient.wyslijGlos(ogg, podpis),
      });
    } finally {
      this.skrzynkaPracuje = false;
    }
  }

  private zatrzymajSkrzynke(): void {
    if (this.skrzynka !== null) window.clearInterval(this.skrzynka);
    this.skrzynka = null;
  }

  /** Whisper, wybrany model i ffmpeg na miejscu — inaczej bot prosi o tekst. */
  private mowaGotowa(): boolean {
    const s = stan(this.home);
    const model = this.settings().whisperModel;
    return s.obslugiwane && !!s.whisper && !!s.ffmpeg
      && (MODELE_MOWY as readonly unknown[]).includes(model) && !!s.modeleMowy[model as NazwaModeluMowy];
  }

  private obsluz(tekst: string, kiedy: Date, zGlosu: boolean): string {
    const s = this.settings();
    const name = resolveAssistantName(s.assistantName);
    const dir = folderMostu(s, this.home);
    // Most wylaczony miedzy odebraniem a obsluga — klient zaraz stanie
    if (!dir) return tekstyMostu(name).blad;
    return obsluzWiadomosc(tekst, { dir, name, kiedy, zGlosu });
  }
}
