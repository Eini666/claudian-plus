/**
 * Skrzynka glosowek: Claude zostawia `glosowka-<rdzen>.txt` w folderze mostu, wtyczka zamienia
 * go w glosowke na Telegramie i odpisuje `glosowka-<rdzen>.wynik`. Odpowiednik `ari-glos.mjs`
 * z JARVIS-a dla mostu wbudowanego; po wysylce flaga `czeka`, zeby odpowiedz z telefonu
 * wrocila do karty nawet w trybie domowym.
 */

import * as fs from 'fs';
import * as path from 'path';

import { flagaPozaDomem } from '../chat/services/ariTelefon';
import { flagaCzeka } from './bridgeRouter';
import { plikWyniku, WYNIK, WZOR_GLOSOWKI } from './voiceInstructions';

export interface ZaleznosciSkrzynki {
  /** Tekst -> sciezka OGG w tmp (`voiceTools.syntezuj`). */
  syntezuj: (tekst: string) => Promise<string>;
  /** `TelegramClient.wyslijGlos`. */
  wyslijGlos: (oggPath: string, podpis?: string) => Promise<void>;
  teraz?: number;
}

const LIMIT_PODPISU = 1024;
const WYNIK_WAZNY_MS = 60 * 60 * 1000;

/** Jeden przebieg skrzynki. Nie rzuca; kazda zabrana glosowka konczy sie plikiem `.wynik`. */
export async function przetworzGlosowki(dir: string, zal: ZaleznosciSkrzynki): Promise<void> {
  const teraz = zal.teraz ?? Date.now();
  let nazwy: string[];
  try {
    nazwy = fs.readdirSync(dir);
  } catch {
    return; // folderu jeszcze nie ma — nic nie czeka
  }

  for (const nazwa of nazwy) {
    if (!nazwa.startsWith('glosowka-') || !nazwa.endsWith('.wynik')) continue;
    const plik = path.join(dir, nazwa);
    try {
      if (teraz - fs.statSync(plik).mtimeMs > WYNIK_WAZNY_MS) fs.rmSync(plik, { force: true });
    } catch { /* zniknal w miedzyczasie */ }
  }

  for (const nazwa of nazwy.filter((n) => WZOR_GLOSOWKI.test(n))) {
    const plik = path.join(dir, nazwa);
    const tekst = zabierz(plik);
    if (tekst === null) continue; // zabral je inny przebieg albo drugie okno
    const wynik = await wyslij(dir, tekst, zal);
    try {
      fs.writeFileSync(plikWyniku(plik), wynik, 'utf8');
    } catch { /* bez wyniku Claude odpowie na czacie; glosowka i tak nie wraca do kolejki */ }
  }
}

/** Rename pod unikalna nazwe jak `odbierzWiadomosc`: dwa okna nie wysla tej samej glosowki. */
function zabierz(plik: string): string | null {
  const zabrany = `${plik}.${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(plik, zabrany);
  } catch {
    return null;
  }
  try {
    return fs.readFileSync(zabrany, 'utf8').trim();
  } catch {
    return '';
  } finally {
    fs.rmSync(zabrany, { force: true });
  }
}

async function wyslij(dir: string, tekst: string, zal: ZaleznosciSkrzynki): Promise<string> {
  if (!fs.existsSync(flagaPozaDomem(dir))) return WYNIK.domowy;
  let ogg: string | null = null;
  try {
    ogg = await zal.syntezuj(tekst);
    await zal.wyslijGlos(ogg, tekst.length <= LIMIT_PODPISU ? tekst : undefined);
    fs.writeFileSync(flagaCzeka(dir), String(Date.now()));
    return WYNIK.wyslano;
  } catch (err) {
    // Bledy klienta Telegrama sa juz oczyszczone z tokenu i adresow API
    return `błąd: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`;
  } finally {
    if (ogg) fs.rmSync(ogg, { force: true });
  }
}
