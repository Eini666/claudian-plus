/**
 * Plywajacy awatar Ari na pulpicie — osobne okno Electrona, ktore widac
 * dopiero wtedy, gdy Obsidian jest w tle (ustalenia z użytkownikiem, 13.09).
 * Kropka na pasku zadan mowi „cos sie dzieje"; to okno mowi CO sie dzieje,
 * bo `setOverlayIcon` przyjmuje tylko statyczna ikone 16x16.
 *
 * Okno powstaje przez `remote.BrowserWindow`, a tresc idzie w `data:`-URL,
 * wiec nie ma IPC, portu ani drugiego procesu do pilnowania.
 */

import { ARI_RESTING, type AriLook, lookForSignal } from './AriAvatar';
import type { TurnSignal } from './TurnNotifier';
import { subscribeTurn } from './TurnNotifier';

/** Silnik robota dla okna — tekst IIFE z `ariRobotWidget.ts`, wstrzykiwany przez esbuild. */
declare const ARI_ROBOT_WIDGET_JS: string;

/** Powierzchnia okna — wydzielona, zeby decyzje dalo sie testowac bez Electrona. */
export interface WidgetSurface {
  render(look: AriLook): void;
  hide(): void;
  destroy(): void;
}

/**
 * Cala decyzja widgetu: pokazuj, gdy wlaczony i Obsidian NIE jest na wierzchu.
 * Przy aktywnym oknie użytkownik i tak widzi awatar w naglowku rozmowy.
 */
export class AriWidgetController {
  private enabled = false;
  private focused = true;
  private look: AriLook = ARI_RESTING;
  private shown = false;

  constructor(private readonly surface: WidgetSurface) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.apply();
  }

  update(signal: TurnSignal | null, focused: boolean): void {
    this.look = lookForSignal(signal);
    this.focused = focused;
    this.apply();
  }

  private apply(): void {
    const visible = this.enabled && !this.focused;
    if (!visible) {
      if (this.shown) {
        this.surface.hide();
        this.shown = false;
      }
      return;
    }
    this.surface.render(this.look);
    this.shown = true;
  }

  dispose(): void {
    this.shown = false;
    this.surface.destroy();
  }
}

/** 240 od 13.10 — przy 120 twarz LED robota byla za drobna. */
const WIDGET_SIZE = 240;
const SCREEN_MARGIN = 24;

interface RemoteWindow {
  loadURL(url: string): Promise<void>;
  webContents: { executeJavaScript(code: string): Promise<unknown> };
  getPosition(): number[];
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setPosition(x: number, y: number): void;
  showInactive(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
}

interface Obszar { x: number; y: number; width: number; height: number }

interface RemoteScreen {
  getPrimaryDisplay(): { workArea: Obszar };
  getAllDisplays(): { workArea: Obszar }[];
}

interface WidgetRemote {
  BrowserWindow?: new (options: Record<string, unknown>) => RemoteWindow;
  screen?: RemoteScreen;
  require?: (name: string) => { BrowserWindow?: new (options: Record<string, unknown>) => RemoteWindow };
}

/**
 * Zapamietana pozycja okna. `localStorage` zamiast ustawien wtyczki, bo to stan
 * okna, nie konfiguracja — nie ma po co jezdzic przez `mutateSettings` i zapis
 * na dysk przy kazdym przesunieciu.
 */
const KLUCZ_POZYCJI = 'claudian-ari-widget-pos';

/** Pozycja jest dobra tylko wtedy, gdy okno bedzie NA KTORYMS ekranie. Inaczej po
 *  odlaczeniu monitora albo zmianie rozdzielczosci widget wyladowalby w prozni. */
function pozycjaNaEkranie(x: number, y: number, ekrany: Obszar[]): boolean {
  return ekrany.some(o => x + WIDGET_SIZE > o.x
    && x < o.x + o.width
    && y + WIDGET_SIZE > o.y
    && y < o.y + o.height);
}

function wczytajPozycje(ekrany: Obszar[]): [number, number] | null {
  try {
    const zapis = window.localStorage.getItem(KLUCZ_POZYCJI);
    if (!zapis) return null;
    const { x, y } = JSON.parse(zapis) as { x: number; y: number };
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!ekrany.length || !pozycjaNaEkranie(x, y, ekrany)) return null;
    return [x, y];
  } catch {
    return null;
  }
}

function zapiszPozycje(win: RemoteWindow): void {
  try {
    const [x, y] = win.getPosition();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    window.localStorage.setItem(KLUCZ_POZYCJI, JSON.stringify({ x, y }));
  } catch {
    // Pozycja to wygoda — brak zapisu nie moze przewrocic chowania okna.
  }
}

/** Wywolanie stanu w oknie; JSON jest poprawnym literalem JS. */
export const setCall = (look: AriLook) => 'window.ariRobot && ariRobot.set('
  + `document.getElementById('r'), document.getElementById('c'), ${JSON.stringify(look)})`;

export function widgetHtml(look: AriLook): string {
  const engine = typeof ARI_ROBOT_WIDGET_JS === 'string' ? ARI_ROBOT_WIDGET_JS : '';
  // Cale tlo ciagnie okno: w srodku nie ma nic klikalnego, wiec pelny obszar
  // przeciagania jest tanszy niz osobny pasek (pulapka z widgetu JARVIS-a:
  // `-webkit-app-region: drag` zjada hover i klikniecia pod soba).
  // `<\/` — zeby zaden `</script>` w bundlu nie zamknal tagu przedwczesnie.
  return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;'
    + 'background:transparent;overflow:hidden;-webkit-app-region:drag}#r{width:100%;height:100%}</style>'
    + '<body><div id="r"><canvas id="c"></canvas></div>'
    + `<script>${engine.replace(/<\//g, '<\\/')}\n${setCall(look)}</script>`;
}

/** Prawdziwe okno; null poza Electronem albo gdy remote nie wystawia konstruktora. */
export function createElectronWidgetSurface(): WidgetSurface | null {
  let remote: WidgetRemote | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
    remote = (require('electron') as { remote?: WidgetRemote }).remote;
  } catch {
    return null;
  }
  const BrowserWindow = remote?.BrowserWindow ?? remote?.require?.('electron')?.BrowserWindow;
  if (!BrowserWindow) return null;

  let win: RemoteWindow | null = null;
  let detachUnload: (() => void) | null = null;

  const ensureWindow = (): RemoteWindow => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: WIDGET_SIZE,
      height: WIDGET_SIZE,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
    });
    // 'screen-saver' trzyma okno nad pelnoekranowymi oknami innych aplikacji.
    win.setAlwaysOnTop(true, 'screen-saver');
    const ekrany = remote?.screen?.getAllDisplays?.().map(d => d.workArea) ?? [];
    const zapamietana = wczytajPozycje(ekrany);
    if (zapamietana) {
      win.setPosition(zapamietana[0], zapamietana[1]);
    } else {
      const area = remote?.screen?.getPrimaryDisplay().workArea;
      if (area) {
        win.setPosition(
          area.x + area.width - WIDGET_SIZE - SCREEN_MARGIN,
          area.y + area.height - WIDGET_SIZE - SCREEN_MARGIN,
        );
      }
    }
    // 🔴 Electron konczy prace dopiero, gdy znikna WSZYSTKIE okna. To okno ma
    // `skipTaskbar`, wiec jest niewidoczne — i zamkniecie Obsidiana zostawialo
    // wiszacy proces glowny. Kolejny start zastawal go bez otwartego skarbca
    // i pokazywal wybor vaulta zamiast ostatniego (zlapane 13.09: proces glowny
    // zyl 6 godzin, a kazde „uruchomienie" tworzylo tylko nowe okno).
    if (!detachUnload) {
      const przyZamknieciu = () => {
        if (!win || win.isDestroyed()) return;
        // Zamkniecie Obsidiana omija `hide()`, wiec bez tego pozycja przezywala
        // tylko zejscie w tlo, a gubila sie po restarcie aplikacji (13.09).
        zapiszPozycje(win);
        win.destroy();
        win = null;
      };
      window.addEventListener('beforeunload', przyZamknieciu);
      detachUnload = () => window.removeEventListener('beforeunload', przyZamknieciu);
    }
    return win;
  };

  // Okno, do ktorego juz wgralismy strone z silnikiem — nowe okno (po `destroy`
  // albo zamknieciu) dostaje strone od nowa, istniejace tylko zmiane stanu.
  let loadedInto: RemoteWindow | null = null;
  let painted = '';
  return {
    render: (look) => {
      const target = ensureWindow();
      const key = JSON.stringify(look);
      if (loadedInto !== target) {
        loadedInto = target;
        painted = key;
        void target.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(widgetHtml(look)));
      } else if (key !== painted) {
        painted = key;
        // Bez przeladowania robot gra przejscie miedzy stanami. Electron sam czeka
        // z wykonaniem, jesli strona jeszcze sie laduje.
        target.webContents.executeJavaScript(setCall(look)).catch(() => undefined);
      }
      target.showInactive();
    },
    hide: () => {
      if (!win || win.isDestroyed()) return;
      // Powrot do Obsidiana to naturalny moment na zapis — bez nasluchu przeciagania
      // i bez ruchu przez IPC przy kazdym drgnieciu myszy.
      zapiszPozycje(win);
      win.hide();
    },
    destroy: () => {
      detachUnload?.();
      detachUnload = null;
      if (win && !win.isDestroyed()) {
        zapiszPozycje(win);
        win.destroy();
      }
      win = null;
      loadedInto = null;
      painted = '';
    },
  };
}

let shared: AriWidgetController | null | undefined;
let unsubscribe: (() => void) | null = null;

/**
 * Jeden widget na Obsidiana — kilka widokow czatu dzieli to samo okno.
 * Sluchacza zaklada sam widget, nie widok: gdyby wisial na widoku, zamkniecie
 * jednego panelu zostawiloby okno na pulpicie bez zadnych aktualizacji.
 */
export function getAriWidget(): AriWidgetController | null {
  if (shared === undefined) {
    const surface = createElectronWidgetSurface();
    shared = surface ? new AriWidgetController(surface) : null;
    if (shared) {
      const widget = shared;
      unsubscribe = subscribeTurn((signal, focused) => widget.update(signal, focused));
    }
  }
  return shared;
}

/** Wolane przy wyladowaniu wtyczki — inaczej okno zostaje na wierzchu po wylaczeniu. */
export function disposeAriWidget(): void {
  unsubscribe?.();
  unsubscribe = null;
  shared?.dispose();
  shared = undefined;
}
