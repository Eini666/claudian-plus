/**
 * Most Claudian ↔ telefon przez zewnętrzny program (np. asystent głosowy z botem Telegrama).
 *
 * Program zapisuje do folderu z ustawień (`telegramBridgeDir`) dwie rzeczy, które tu czytamy:
 * - `poza-domem` — flaga trybu; przełącza ją `AwayToggle` albo „wychodzę"/„wróciłem" z telefonu,
 * - `wiadomosc.txt` — wiadomość wysłana z telefonu przy włączonej fladze.
 * Nazwy plików to kontrakt z programem po drugiej stronie — jedyne miejsce definicji to stałe niżej.
 */

import * as fs from 'fs';
import * as path from 'path';

import { domyslnyFolderMostu } from '../../telegram/plusHome';

/** Fragment ustawień mostu; wartości sprawdzane w `folderMostu`, bo ustawienia przychodzą z dysku. */
export interface MostTelegrama {
  telegramBridgeEnabled?: unknown;
  telegramBridgeMode?: unknown;
  telegramBridgeDir?: unknown;
}

/**
 * Folder mostu albo `null`, gdy most wyłączony. Tryb wbudowany bez własnego folderu bierze
 * `~/.claudian-plus/most`; każdy inny (zewnętrzny, brak trybu) wymaga folderu jak w etapie 1.
 */
export function folderMostu(settings: MostTelegrama, home?: string): string | null {
  if (settings.telegramBridgeEnabled !== true) return null;
  const dir = typeof settings.telegramBridgeDir === 'string' ? settings.telegramBridgeDir.trim() : '';
  if (dir) return dir;
  return settings.telegramBridgeMode === 'builtin' ? domyslnyFolderMostu(home) : null;
}

export const flagaPozaDomem = (dir: string): string => path.join(dir, 'poza-domem');
export const PLIK_WIADOMOSCI = 'wiadomosc.txt';
/** Zgodność wsteczna z zewnętrznymi programami, które piszą starą nazwę — czytana tylko poza trybem wbudowanym. */
export const PLIK_WIADOMOSCI_STARY = 'ari-wiadomosc.txt';
/** Timestamp ms ostatniej glosowki wyslanej z karty (tryb wbudowany); nastepna wiadomosc z telefonu to odpowiedz. */
export const PLIK_CZEKA = 'czeka';

/**
 * Zabiera wiadomość z telefonu, jeśli jakaś czeka. Plik jest najpierw przenoszony pod
 * unikalną nazwę: dwa okna Claudiana albo dopis programu w trakcie odczytu nie mogą
 * wysłać tej samej wiadomości dwa razy ani zgubić nowej.
 */
export function odbierzWiadomosc(settings: MostTelegrama): string | null {
  const dir = folderMostu(settings);
  if (!dir || !fs.existsSync(flagaPozaDomem(dir))) return null;
  const nazwy = settings.telegramBridgeMode === 'builtin'
    ? [PLIK_WIADOMOSCI]
    : [PLIK_WIADOMOSCI, PLIK_WIADOMOSCI_STARY];
  // throwIfNoEntry: drugie okno moze zabrac plik miedzy listowaniem a odczytem.
  const pliki = nazwy
    .map((nazwa) => ({ plik: path.join(dir, nazwa), stat: fs.statSync(path.join(dir, nazwa), { throwIfNoEntry: false }) }))
    .filter((p) => p.stat)
    .sort((a, b) => (a.stat?.mtimeMs ?? 0) - (b.stat?.mtimeMs ?? 0));
  // Obie nazwy naraz → jedna wiadomość: części w kolejności zapisu, rozdzielone pustą linią.
  const tresc = pliki.map((p) => zabierz(p.plik)).filter(Boolean).join('\n\n');
  return tresc || null;
}

function zabierz(wiadomosc: string): string {
  const zabrana = `${wiadomosc}.${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(wiadomosc, zabrana);
  } catch {
    return '';
  }
  const tresc = fs.readFileSync(zabrana, 'utf8').trim();
  fs.unlinkSync(zabrana);
  return tresc;
}
