/**
 * Wtyczka jako gospodarz panelu kont: zapisuje osadzone pliki, startuje serwer, przejmuje swoj
 * (np. po Ctrl+R) i nie dotyka cudzego — panel uruchomiony poza wtyczka nie zna `/api/health`.
 *
 * Runtime to wylacznie `node` z PATH. Sonda 08.11: Obsidian z `ELECTRON_RUN_AS_NODE=1` nie dziala
 * jako Node (fuse wylaczony) — przekazuje skrypt dzialajacej instancji jako plik do otwarcia.
 */

import { type ChildProcess, spawn as nodeSpawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { fetchPanelHealth, stopPanel } from '../../utils/accountsPanel';
import {
  osadzonePliki,
  PLIK_LOGU,
  PLIK_SERWERA,
  type PlikiPanelu,
  wersjaPanelu,
  zapiszPlikiPanelu,
} from './panelFiles';

export type StanPanelu = 'nasz' | 'obcy' | 'wylaczony' | 'nielokalny' | 'brak-node' | 'blad';

export interface UstawieniaPanelu {
  accountSwitcherEnabled?: unknown;
  accountsPanelManaged?: unknown;
  accountsPanelUrl?: unknown;
}

export interface OpcjeHosta {
  home?: string;
  spawn?: typeof nodeSpawn;
  health?: typeof fetchPanelHealth;
  stopPanel?: typeof stopPanel;
  pliki?: PlikiPanelu;
  /** Odstep odpytywania `health`; testy go skracaja. */
  krokMs?: number;
}

const DOMYSLNY_PORT = 7788;
const LIMIT_CISZY_MS = 5000;
const LIMIT_STARTU_MS = 10_000;
const LOKALNE = new Set(['127.0.0.1', 'localhost']);

const czekaj = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function ostatniaLinia(plik: string): string | null {
  try {
    const linie = fs.readFileSync(plik, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return linie[linie.length - 1] ?? null;
  } catch {
    return null;
  }
}

export class AccountsPanelHost {
  private _stan: StanPanelu = 'wylaczony';
  private _powod = '';
  private proces: ChildProcess | null = null;
  /** Adres i port panelu uruchomionego albo przejetego przez wtyczke (tylko przy stanie `nasz`). */
  private naszUrl: string | null = null;
  private naszPort: number | null = null;
  private kolejka: Promise<void> = Promise.resolve();
  private zamkniety = false;
  private readonly sluchacze = new Set<(stan: StanPanelu, powod: string) => void>();

  private readonly home?: string;
  private readonly spawnFn: typeof nodeSpawn;
  private readonly health: typeof fetchPanelHealth;
  private readonly stopFn: typeof stopPanel;
  private readonly pliki: PlikiPanelu;
  private readonly krokMs: number;

  constructor(private readonly settings: () => UstawieniaPanelu, opcje: OpcjeHosta = {}) {
    this.home = opcje.home;
    this.spawnFn = opcje.spawn ?? nodeSpawn;
    this.health = opcje.health ?? fetchPanelHealth;
    this.stopFn = opcje.stopPanel ?? stopPanel;
    this.pliki = opcje.pliki ?? osadzonePliki();
    this.krokMs = opcje.krokMs ?? 250;
  }

  get stan(): { stan: StanPanelu; powod: string } {
    return { stan: this._stan, powod: this._powod };
  }

  /** Zwraca funkcje odpinajaca. */
  naZmiane(cb: (stan: StanPanelu, powod: string) => void): () => void {
    this.sluchacze.add(cb);
    return () => this.sluchacze.delete(cb);
  }

  /** Woluj po starcie i po kazdym zapisie ustawien; wywolania ida po kolei (jeden spawn). */
  odswiez(): Promise<void> {
    return this.wKolejce(() => this.odswiezTeraz());
  }

  restart(): Promise<void> {
    return this.wKolejce(async () => {
      if (this._stan === 'nasz' && this.naszUrl) {
        const url = this.naszUrl;
        this.zatrzymajNasz();
        await this.czekajNaCisze(url);
      }
      await this.odswiezTeraz();
    });
  }

  /** `onunload`: zatrzymuje tylko panel uruchomiony albo przejety przez wtyczke. */
  stop(): void {
    this.zamkniety = true;
    this.zatrzymajNasz();
  }

  private wKolejce(zadanie: () => Promise<void>): Promise<void> {
    this.kolejka = this.kolejka.then(zadanie).catch((err: unknown) => {
      this.ustaw('blad', err instanceof Error ? err.message : String(err));
    });
    return this.kolejka;
  }

  private ustaw(stan: StanPanelu, powod = ''): void {
    if (stan === this._stan && powod === this._powod) return;
    this._stan = stan;
    this._powod = powod;
    for (const cb of this.sluchacze) cb(stan, powod);
  }

  /** Fire-and-forget; uchwyt procesu → kill, przejety → `/api/shutdown`. */
  private zatrzymajNasz(): void {
    if (this._stan !== 'nasz') return;
    const proces = this.proces;
    const url = this.naszUrl;
    this.proces = null;
    this.naszUrl = null;
    this.naszPort = null;
    if (proces) proces.kill();
    else if (url) void this.stopFn(url);
    this.ustaw('wylaczony');
  }

  private async odswiezTeraz(): Promise<void> {
    if (this.zamkniety) return;
    const s = this.settings();
    if (s.accountSwitcherEnabled !== true || s.accountsPanelManaged !== true) {
      this.zatrzymajNasz();
      this.ustaw('wylaczony');
      return;
    }

    let url: URL;
    try {
      url = new URL(String(s.accountsPanelUrl));
    } catch {
      this.zatrzymajNasz();
      this.ustaw('nielokalny', 'niepoprawny adres panelu');
      return;
    }
    if (url.protocol !== 'http:' || !LOKALNE.has(url.hostname)) {
      this.zatrzymajNasz();
      this.ustaw('nielokalny');
      return;
    }
    const port = url.port ? Number(url.port) : DOMYSLNY_PORT;
    const baseUrl = `http://${url.hostname}:${port}`;
    // Inny port niz nasz dzialajacy panel — stary nie moze zostac sierota
    if (this.naszPort !== null && this.naszPort !== port) this.zatrzymajNasz();

    const wersja = wersjaPanelu(this.pliki.mjs);
    if (wersja === null) {
      this.ustaw('blad', 'brak osadzonych plików panelu');
      return;
    }
    const { katalog, zmienione } = zapiszPlikiPanelu(this.home, this.pliki);

    const h = await this.health(baseUrl);
    if (h === 'obcy') {
      // Cudzy panel na naszym porcie — nie dotykamy; ewentualny nasz uchwyt i tak juz nie slucha
      this.proces = null;
      this.naszUrl = null;
      this.naszPort = null;
      this.ustaw('obcy');
      return;
    }
    if (h) {
      if (h.version === wersja && !zmienione) {
        this.naszUrl = baseUrl;
        this.naszPort = port;
        this.ustaw('nasz');
        return;
      }
      // Nasz w starej wersji (albo pliki podmienione pod dzialajacym) — zatrzymaj i postaw nowy
      if (this.proces) this.proces.kill();
      else await this.stopFn(baseUrl);
      this.proces = null;
      if (!(await this.czekajNaCisze(baseUrl))) {
        this.ustaw('blad', 'stary panel nie chce się zatrzymać');
        return;
      }
    }
    await this.start(baseUrl, port, katalog, wersja);
  }

  /** `true`, gdy port zamilkl w limicie. */
  private async czekajNaCisze(baseUrl: string): Promise<boolean> {
    const koniec = Date.now() + LIMIT_CISZY_MS;
    while (Date.now() < koniec) {
      if ((await this.health(baseUrl)) === null) return true;
      await czekaj(this.krokMs);
    }
    return false;
  }

  private async start(baseUrl: string, port: number, katalog: string, wersja: number): Promise<void> {
    const log = path.join(katalog, PLIK_LOGU);
    const fd = fs.openSync(log, 'w');
    let child: ChildProcess;
    try {
      child = this.spawnFn('node', [path.join(katalog, PLIK_SERWERA), 'serve', String(port)], {
        cwd: katalog,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
    } finally {
      // Dziecko ma juz wlasna kopie deskryptora
      fs.closeSync(fd);
    }

    // Słuchacz `exit` przed pierwszym await — szybki upadek (zajęty port) przyszedłby za wcześnie
    let kod: number | null | undefined;
    child.once('exit', (code) => {
      kod = code;
      if (this.proces !== child) return;
      // Padl juz po starcie — UI ma wiedziec, ze panelu nie ma
      this.proces = null;
      this.naszUrl = null;
      this.naszPort = null;
      this.ustaw('blad', ostatniaLinia(log) ?? `serwer zakończył pracę (kod ${String(code)})`);
    });

    const blad = await new Promise<NodeJS.ErrnoException | null>((res) => {
      child.once('spawn', () => res(null));
      child.once('error', (err) => res(err));
    });
    if (blad) {
      this.ustaw(blad.code === 'ENOENT' ? 'brak-node' : 'blad', blad.code === 'ENOENT' ? '' : blad.message);
      return;
    }

    const koniec = Date.now() + LIMIT_STARTU_MS;
    while (Date.now() < koniec) {
      if (kod !== undefined) {
        this.ustaw('blad', ostatniaLinia(log) ?? `serwer zakończył pracę (kod ${String(kod)})`);
        return;
      }
      const h = await this.health(baseUrl);
      if (h && h !== 'obcy' && h.version === wersja) {
        if (this.zamkniety) {
          child.kill();
          return;
        }
        this.proces = child;
        this.naszUrl = baseUrl;
        this.naszPort = port;
        this.ustaw('nasz');
        return;
      }
      await czekaj(this.krokMs);
    }
    child.kill();
    this.ustaw('blad', ostatniaLinia(log) ?? 'panel nie odpowiada');
  }
}
