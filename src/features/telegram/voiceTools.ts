/**
 * Narzedzia glosu w `~/.claudian-plus/bin`: stan, instalacja z przypietego katalogu i synteza
 * tekst -> OGG/Opus (Piper -> WAV -> ffmpeg), tak jak `ari-glos.mjs` w JARVIS-ie.
 * Procesy dostaja tablice argumentow, nigdy powloke.
 */

import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { type Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { katalogNarzedzi } from './plusHome';
import {
  type CoInstalowac, GLOSY, KATALOG, MODELE_MOWY, type Narzedzie, type NazwaGlosu, type NazwaModeluMowy,
} from './voiceCatalog';

export type StanNarzedzi =
  | { obslugiwane: false }
  | {
    obslugiwane: true;
    piper: string | null;
    ffmpeg: string | null;
    glosy: Record<NazwaGlosu, string | null>;
    whisper: string | null;
    modeleMowy: Record<NazwaModeluMowy, string | null>;
  };

/** Otwiera strumien pobierania; atrapa w testach. */
export type Otworz = (url: string) => Promise<Readable>;
export type Postep = (pobrane: number, wszystkie: number) => void;

const LIMIT_PROCESU_MS = 120_000;

export const obslugiwanaPlatforma = (): boolean => process.platform === 'win32' && process.arch === 'x64';

const sciezka = (n: Narzedzie, home?: string): string | null => {
  const plik = path.join(katalogNarzedzi(home), n.cel, n.sprawdz);
  return fs.existsSync(plik) ? plik : null;
};

export function stan(home?: string): StanNarzedzi {
  if (!obslugiwanaPlatforma()) return { obslugiwane: false };
  const glosy = Object.fromEntries(GLOSY.map((g) => [g, sciezka(KATALOG[g], home)])) as Record<NazwaGlosu, string | null>;
  const modeleMowy = Object.fromEntries(MODELE_MOWY.map((m) => [m, sciezka(KATALOG[m], home)])) as
    Record<NazwaModeluMowy, string | null>;
  return {
    obslugiwane: true,
    piper: sciezka(KATALOG.piper, home),
    ffmpeg: sciezka(KATALOG.ffmpeg, home),
    glosy,
    whisper: sciezka(KATALOG.whisper, home),
    modeleMowy,
  };
}

function otworzHttps(url: string, przekierowania = 5): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'claudian-plus' } }, (res) => {
      const kod = res.statusCode ?? 0;
      const dalej = res.headers.location ? new URL(res.headers.location, url) : null;
      if (kod >= 300 && kod < 400 && dalej?.protocol === 'https:' && przekierowania > 0) {
        res.resume();
        resolve(otworzHttps(dalej.toString(), przekierowania - 1));
      } else if (kod !== 200) {
        res.resume();
        reject(new Error(`HTTP ${kod}`));
      } else {
        resolve(res);
      }
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('brak odpowiedzi serwera')));
  });
}

export function uruchom(exe: string, args: string[], wejscie = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let bledy = '';
    const zegar = window.setTimeout(() => child.kill(), LIMIT_PROCESU_MS);
    child.stderr?.on('data', (d: Buffer) => { bledy = (bledy + d.toString()).slice(-400); });
    child.on('error', (err) => { window.clearTimeout(zegar); reject(err); });
    child.on('close', (kod, sygnal) => {
      window.clearTimeout(zegar);
      if (kod === 0) resolve();
      else reject(new Error(`${path.basename(exe)} zakonczyl sie bledem (${kod ?? sygnal}): ${bledy.trim()}`));
    });
    child.stdin?.on('error', () => { /* proces padl przed odczytem; blad przyjdzie z 'close' */ });
    child.stdin?.end(wejscie, 'utf8');
  });
}

/** Systemowy bsdtar z Windows 10+ (rozpakowuje zip); `tar` z Gita na PATH by nie umial. */
const tar = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

export async function zainstaluj(
  co: CoInstalowac,
  postep?: Postep,
  home?: string,
  opcje: { otworz?: Otworz; katalog?: Record<string, Narzedzie> } = {},
): Promise<string> {
  if (!obslugiwanaPlatforma()) throw new Error('Narzedzia glosu sa obslugiwane tylko na Windows x64');
  const n = (opcje.katalog ?? KATALOG)[co];
  if (!n) throw new Error(`Nieznane narzedzie: ${String(co)}`);
  const otworz = opcje.otworz ?? otworzHttps;
  const bin = katalogNarzedzi(home);
  const cel = path.join(bin, n.cel);
  const robocze = path.join(bin, `.instalacja-${randomUUID()}`);
  const wszystkie = n.pliki.reduce((s, p) => s + p.rozmiar, 0);
  let pobrane = 0;
  fs.mkdirSync(robocze, { recursive: true });
  try {
    for (const p of n.pliki) {
      const part = path.join(robocze, `${p.nazwa}.part`);
      const hash = createHash('sha256');
      let bajty = 0;
      const licz = new Transform({
        transform(kawalek: Buffer, _kod, gotowe) {
          bajty += kawalek.length;
          if (bajty > p.rozmiar) { gotowe(new Error('plik wiekszy niz w katalogu')); return; }
          hash.update(kawalek);
          pobrane += kawalek.length;
          postep?.(pobrane, wszystkie);
          gotowe(null, kawalek);
        },
      });
      try {
        await pipeline(await otworz(p.url), licz, fs.createWriteStream(part));
      } catch (err) {
        throw new Error(`Pobieranie ${p.nazwa} przerwane: ${(err as Error).message}`, { cause: err });
      }
      if (bajty !== p.rozmiar || hash.digest('hex') !== p.sha256) {
        throw new Error(`Niezgodna suma SHA-256 pliku ${p.nazwa} — plik odrzucony`);
      }
      fs.renameSync(part, path.join(robocze, p.nazwa));
    }
    let gotowy = robocze;
    if (n.rozpakuj) {
      const wypak = path.join(robocze, 'rozpakowane');
      fs.mkdirSync(wypak);
      const zip = path.join(robocze, n.pliki[0].nazwa);
      await uruchom(tar(), ['-xf', zip, '-C', wypak, ...(n.rozpakuj.czlonek ? [n.rozpakuj.czlonek] : [])]);
      gotowy = path.join(wypak, ...n.rozpakuj.korzen.split('/'));
    }
    if (!fs.existsSync(path.join(gotowy, n.sprawdz))) throw new Error(`Paczka nie zawiera ${n.sprawdz}`);
    // Windows nie nadpisze katalogu rename'em: stary na bok, nowy na miejsce, stary do kosza.
    const stary = `${cel}.stary-${randomUUID()}`;
    fs.mkdirSync(path.dirname(cel), { recursive: true });
    if (fs.existsSync(cel)) fs.renameSync(cel, stary);
    try {
      fs.renameSync(gotowy, cel);
    } catch (err) {
      if (fs.existsSync(stary)) fs.renameSync(stary, cel);
      throw err;
    }
    fs.rmSync(stary, { recursive: true, force: true });
    return path.join(cel, n.sprawdz);
  } finally {
    fs.rmSync(robocze, { recursive: true, force: true });
  }
}

/** Tekst -> plik OGG/Opus w katalogu tymczasowym; usuniecie pliku po wysylce nalezy do wolajacego. */
export async function syntezuj(tekst: string, glos: string, home?: string): Promise<string> {
  const s = stan(home);
  if (!s.obslugiwane) throw new Error('Narzedzia glosu sa obslugiwane tylko na Windows x64');
  if (!tekst.trim()) throw new Error('Pusty tekst glosowki');
  if (!(GLOSY as readonly string[]).includes(glos)) throw new Error(`Nieznany glos: ${glos}`);
  if (!s.piper) throw new Error('Piper niezainstalowany');
  if (!s.ffmpeg) throw new Error('ffmpeg niezainstalowany');
  const model = s.glosy[glos as NazwaGlosu];
  if (!model) throw new Error(`Glos ${glos} niezainstalowany`);
  const baza = path.join(os.tmpdir(), `claudian-plus-${randomUUID()}`);
  const wav = `${baza}.wav`;
  const ogg = `${baza}.ogg`;
  try {
    await uruchom(s.piper, ['--model', model, '--output_file', wav], tekst);
    await uruchom(s.ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', '32k', ogg]);
    return ogg;
  } catch (err) {
    fs.rmSync(ogg, { force: true });
    throw err;
  } finally {
    fs.rmSync(wav, { force: true });
  }
}
