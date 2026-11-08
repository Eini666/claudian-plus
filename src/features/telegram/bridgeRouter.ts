/**
 * Router mostu wbudowanego: wiadomosc z bota → pliki w folderze mostu, odpowiedz → bot.
 * Nazwy plikow ze stalych w `ariTelefon.ts`, bo karte obsluguje ten sam `odbierzWiadomosc`
 * niezaleznie od tego, ktory program pisze do folderu. Wbudowany bot pisze tylko nowe nazwy.
 */

import * as fs from 'fs';
import * as path from 'path';

import { flagaPozaDomem, PLIK_CZEKA, PLIK_WIADOMOSCI } from '../chat/services/ariTelefon';

export const flagaCzeka = (dir: string): string => path.join(dir, PLIK_CZEKA);
const plikWiadomosci = (dir: string): string => path.join(dir, PLIK_WIADOMOSCI);

const CZEKA_WAZNA_MS = 60 * 60 * 1000; // starsza flaga przejelaby kazda wiadomosc na zawsze
const ZALEGLA_MS = 5 * 60 * 1000;

export const tekstyMostu = (name: string) => ({
  pozaDomem: `Tryb poza domem: ${name} będzie raportować głosówkami.`,
  domowy: `Tryb domowy: ${name} pisze tylko na ekranie.`,
  odmowa: `Tryb domowy — ${name} nie odbiera z telefonu. Napisz „wychodzę”, żeby to zmienić.`,
  pusta: `Słucham — napisz, co ${name} ma zrobić.`,
  przyjeta: `Przekazane do ${name}.`,
  /** Glosowka: odsylamy uslyszany tekst, zeby bylo widac, co zrozumial bot. */
  przyjetaGlos: (tresc: string) => `Przekazane do ${name}: „${tresc}”`,
  niewyrazna: 'Nie usłyszałam nic wyraźnego — powtórz albo napisz tekstem.',
  zalegla: 'Ta wiadomość przyszła, gdy Obsidian był wyłączony. Wyślij ją jeszcze raz, jeśli nadal aktualna.',
  blad: 'Nie udało się przekazać wiadomości — spróbuj za chwilę.',
});

export interface KontekstMostu {
  dir: string;
  name: string;
  /** Czas nadania wiadomosci. */
  kiedy: Date;
  teraz?: number;
  /** Tekst z transkrypcji glosowki. */
  zGlosu?: boolean;
}

/** Zwraca odpowiedz dla bota. Nie rzuca — blad zapisu konczy sie tekstem bez szczegolow. */
export function obsluzWiadomosc(
  tekst: string,
  { dir, name, kiedy, teraz = Date.now(), zGlosu = false }: KontekstMostu,
): string {
  const t = tekstyMostu(name);
  // Przed flaga `czeka`: szum nie moze zuzyc czekania na odpowiedz.
  if (zGlosu && !tekst.trim()) return t.niewyrazna;
  try {
    fs.mkdirSync(dir, { recursive: true });

    // Rdzen zamiast pelnego slowa: whisper slyszy „Wychodzę!" jako „Wychodzą!".
    const komenda = tekst.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (/^wychodz\p{L}{0,2}$/u.test(komenda)) {
      fs.writeFileSync(flagaPozaDomem(dir), new Date(teraz).toISOString());
      return t.pozaDomem;
    }
    if (/^wr[oó]ci[lł]\p{L}{0,2}$/u.test(komenda)) {
      fs.rmSync(flagaPozaDomem(dir), { force: true });
      return t.domowy;
    }

    // Przed flaga `czeka`, zeby nocna zaleglosc jej nie zuzyla.
    if (teraz - kiedy.getTime() > ZALEGLA_MS) return t.zalegla;

    let odpowiedzNaGlosowke = false;
    const czeka = flagaCzeka(dir);
    if (fs.existsSync(czeka)) {
      odpowiedzNaGlosowke = teraz - Number(fs.readFileSync(czeka, 'utf8')) < CZEKA_WAZNA_MS;
      fs.rmSync(czeka, { force: true });
    }
    if (!odpowiedzNaGlosowke && !fs.existsSync(flagaPozaDomem(dir))) return t.odmowa;

    const tresc = tekst.replace(wzorNazwy(name), '').trim();
    if (!tresc) return t.pusta;
    const plik = plikWiadomosci(dir);
    fs.appendFileSync(plik, `${fs.existsSync(plik) ? '\n\n' : ''}${tresc}`, 'utf8');
    return zGlosu ? t.przyjetaGlos(tresc) : t.przyjeta;
  } catch {
    return t.blad;
  }
}

/** Nazwa asystenta na poczatku („Claude, …", „claude: …") — zdejmowana, reszta idzie do karty. */
function wzorNazwy(name: string): RegExp {
  const nazwa = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${nazwa}(?![\\p{L}])[\\s,.:;!?-]*`, 'iu');
}
