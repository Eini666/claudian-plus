/**
 * Pliki panelu kont osadzone w `main.js` (wtyczka instaluje sie trzema plikami, `.mjs` nie ma jak
 * dolozyc). Przy starcie wtyczka zapisuje je do `~/.claudian-plus/accounts/`, gdy skrot sie rozni.
 * `accounts.mjs` i `panel.html` musza lezec obok siebie — serwer czyta HTML z `import.meta.dirname`.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { katalogPlus } from '../telegram/plusHome';

// Wstrzykiwane przez `define` w esbuild.config.mjs; w testach nie istnieja.
declare const ACCOUNTS_PANEL_MJS: string;
declare const ACCOUNTS_PANEL_HTML: string;

export interface PlikiPanelu {
  mjs: string;
  html: string;
}

export const PLIK_SERWERA = 'accounts.mjs';
export const PLIK_HTML = 'panel.html';
export const PLIK_WERSJI = '.wersja';
export const PLIK_LOGU = 'serwer.log';

export const katalogPanelu = (home?: string): string => path.join(katalogPlus(home), 'accounts');

export const osadzonePliki = (): PlikiPanelu => ({
  mjs: typeof ACCOUNTS_PANEL_MJS === 'string' ? ACCOUNTS_PANEL_MJS : '',
  html: typeof ACCOUNTS_PANEL_HTML === 'string' ? ACCOUNTS_PANEL_HTML : '',
});

/** `PANEL_VERSION` z treści serwera; `null`, gdy treści brak. */
export function wersjaPanelu(mjs: string): number | null {
  const m = /PANEL_VERSION = (\d+)/.exec(mjs);
  return m ? Number(m[1]) : null;
}

function zapiszAtomowo(plik: string, tresc: string): void {
  const tmp = `${plik}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, tresc, 'utf8');
    fs.renameSync(tmp, plik);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Zapis tylko przy innym skrócie albo brakującym pliku; `zmienione` mówi, czy cokolwiek poszło na dysk. */
export function zapiszPlikiPanelu(
  home?: string,
  pliki: PlikiPanelu = osadzonePliki(),
): { katalog: string; zmienione: boolean } {
  const katalog = katalogPanelu(home);
  const skrot = createHash('sha256').update(pliki.mjs).update('\0').update(pliki.html).digest('hex');
  const plikWersji = path.join(katalog, PLIK_WERSJI);
  let zapisany = '';
  try { zapisany = fs.readFileSync(plikWersji, 'utf8').trim(); } catch { /* pierwszy zapis */ }
  const sa = fs.existsSync(path.join(katalog, PLIK_SERWERA)) && fs.existsSync(path.join(katalog, PLIK_HTML));
  if (zapisany === skrot && sa) return { katalog, zmienione: false };

  fs.mkdirSync(katalog, { recursive: true });
  zapiszAtomowo(path.join(katalog, PLIK_SERWERA), pliki.mjs);
  zapiszAtomowo(path.join(katalog, PLIK_HTML), pliki.html);
  // Skrót na końcu: przerwany zapis zostawia stary skrót, więc następny start zapisze jeszcze raz
  zapiszAtomowo(plikWersji, skrot);
  return { katalog, zmienione: true };
}
