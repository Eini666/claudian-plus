/**
 * Katalog domowy Claudian Plus (`~/.claudian-plus`) — poza vaultem, bo vault bywa
 * synchronizowany albo w gicie, a tu leza token Telegrama i pobrane narzedzia.
 * Parametr `home` istnieje dla testow; w kodzie wtyczki zostaje domyslny.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SekretyTelegrama {
  token: string;
  /** `null` do czasu sparowania czatu. */
  chatId: number | null;
}

export const katalogPlus = (home: string = os.homedir()): string => path.join(home, '.claudian-plus');
export const plikSekretow = (home?: string): string => path.join(katalogPlus(home), 'telegram.json');
export const katalogNarzedzi = (home?: string): string => path.join(katalogPlus(home), 'bin');
export const domyslnyFolderMostu = (home?: string): string => path.join(katalogPlus(home), 'most');
export const plikBlokadyMostu = (home?: string): string => path.join(katalogPlus(home), 'most.lock');

/** Sekrety z dysku albo `null`, gdy pliku brak lub jest uszkodzony. Nigdy nie rzuca. */
export function czytajSekrety(home?: string): SekretyTelegrama | null {
  try {
    const dane = JSON.parse(fs.readFileSync(plikSekretow(home), 'utf8')) as Record<string, unknown>;
    const { token, chatId } = dane;
    if (typeof token !== 'string' || !token.trim()) return null;
    if (chatId != null && !Number.isSafeInteger(chatId)) return null;
    return { token: token.trim(), chatId: (chatId as number | undefined) ?? null };
  } catch {
    return null;
  }
}

/** Zapis atomowy (`.tmp` + rename); blad niesie tylko kod i sciezke, nigdy wartosc tokenu. */
export function zapiszSekrety(sekrety: SekretyTelegrama, home?: string): void {
  const plik = plikSekretow(home);
  const tmp = `${plik}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(plik), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(sekrety, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, plik);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    const kod = (err as NodeJS.ErrnoException).code ?? 'nieznany';
    // cause = blad fs (sciezka + kod), tresc pliku do niego nie trafia
    throw new Error(`Nie udalo sie zapisac ustawien Telegrama (${plik}): ${kod}`, { cause: err });
  }
}
