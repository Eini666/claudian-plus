/**
 * Instrukcja glosowek dla Claude w trybie poza domem (most wbudowany). Idzie jako dynamiczna
 * sekcja promptu systemowego; jej zmiana zmienia `restartKey`, wiec cieply proces agenta
 * restartuje sie sam przy nastepnej turze po „wychodzę"/„wróciłem".
 * Tryb `external` nie dostaje nic: tam instrukcje daje hook projektu, a glosowki wysyla JARVIS.
 */

import * as fs from 'fs';
import * as path from 'path';

import { flagaPozaDomem, folderMostu, type MostTelegrama } from '../chat/services/ariTelefon';

/** Kontrakt z `voiceOutbox`: Claude zapisuje `<rdzen>.txt`, wtyczka odpisuje `<rdzen>.wynik`. */
export const WZOR_GLOSOWKI = /^glosowka-[A-Za-z0-9_-]{1,40}\.txt$/;
export const plikWyniku = (plikGlosowki: string): string => plikGlosowki.replace(/\.txt$/, '.wynik');

export const WYNIK = {
  wyslano: 'wysłano',
  domowy: 'tryb domowy',
} as const;

const tekstInstrukcji = (folder: string): string => `## Głosówki na telefon

Użytkownik jest poza domem i NIE widzi ekranu. Wiadomości z prefiksem [Telegram] przyszły z jego telefonu.
Po każdym zakończonym etapie pracy, przy każdej odpowiedzi na wiadomość [Telegram] i zawsze, gdy potrzebujesz decyzji, wyślij głosówkę:
1. Zapisz tekst do pliku ${folder}${path.sep}glosowka-<6 losowych liter lub cyfr>.txt — maks. ~70 słów, po polsku, bez markdownu; decyzje jako numerowane opcje.
2. Po kilku sekundach przeczytaj plik o tej samej nazwie z rozszerzeniem .wynik: „${WYNIK.wyslano}” albo opis błędu.
3. W odpowiedzi na czacie wklej dosłownie treść głosówki (rozmowa ma zostać w Claudianie).
Wynik „${WYNIK.domowy}” = głosówka nie poszła — wtedy wystarczy odpowiedź na czacie.`;

/** Folder mostu, gdy most wbudowany jest wlaczony i jest flaga `poza-domem`; inaczej `null`. */
function folderGlosowek(settings: MostTelegrama, home?: string): string | null {
  if (settings.telegramBridgeEnabled !== true || settings.telegramBridgeMode !== 'builtin') return null;
  const dir = folderMostu(settings, home);
  return dir && fs.existsSync(flagaPozaDomem(dir)) ? dir : null;
}

/** Sekcja promptu albo `null`: tylko most wbudowany, wlaczony i z flaga `poza-domem`. */
export function instrukcjaGlosowek(settings: MostTelegrama, home?: string): string | null {
  const dir = folderGlosowek(settings, home);
  return dir ? tekstInstrukcji(dir) : null;
}

/**
 * Krotka instrukcja doklejana do wiadomosci `[Telegram]`. Sama sekcja promptu systemowego nie
 * wystarczyla w tescie na zywo 08.11 (model odpisal tekstem) — jak hook `telegram-glosowka`
 * w JARVIS-owym ukladzie: instrukcja jedzie z ta jedna tura.
 */
export function dopiskGlosowki(settings: MostTelegrama, home?: string): string | null {
  const dir = folderGlosowek(settings, home);
  if (!dir) return null;
  return `(Odpowiedz głosówką: zapisz tekst — maks. ~70 słów, po polsku, bez markdownu — do pliku ${dir}${path.sep}glosowka-<6 losowych znaków>.txt, po kilku sekundach przeczytaj plik .wynik o tej samej nazwie, a treść głosówki wklej dosłownie w odpowiedzi.)`;
}
