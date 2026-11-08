/**
 * Powiadomienia o stanie Ari, gdy Obsidian jest w tle (ustalenia z użytkownikiem, 11.09):
 * kolorowa kropka na ikonie paska zadan — pomaranczowa (pracuje), zielona (skonczyla
 * albo czeka na decyzje), czerwona (blad) — plus systemowy dymek przy koncu i bledzie.
 * Samo migniecie paska w Windows ma jeden kolor, dlatego kolor niesie nakladka na ikone.
 * Przy aktywnym oknie cisza.
 */

import { DEFAULT_ASSISTANT_NAME, resolveAssistantName } from '../../../core/types/settings';

let assistantNameSource: () => unknown = () => DEFAULT_ASSISTANT_NAME;

/** Wtyczka podaje odczyt z ustawien przy starcie — zmiana nazwy dziala bez restartu. */
export function setAssistantNameSource(source: () => unknown): void {
  assistantNameSource = source;
}

function currentAssistantName(): string {
  return resolveAssistantName(assistantNameSource());
}

export type TurnSignal =
  | { kind: 'working' }
  /** Czyta kontekst — narzedzia, ktore tylko patrza. */
  | { kind: 'observing' }
  /** Blok myslenia. */
  | { kind: 'thinking' }
  /** Czeka na podagenta. */
  | { kind: 'processing' }
  /** Pisze odpowiedz — leca fragmenty tekstu (robot „mowi", 12.10). */
  | { kind: 'speaking' }
  | { kind: 'finished'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'waiting' }
  /** Tura przerwana przez użytkownika — bez tego „pracuje" wisialo do nastepnej tury. */
  | { kind: 'cancelled' };

export type OverlayColor = 'orange' | 'green' | 'red';

export interface NotifierDecision {
  overlay: OverlayColor | null;
  flash: boolean;
  toast: { title: string; body: string } | null;
}

export const TURN_COLORS: Record<OverlayColor, string> = {
  orange: '#F59E0B',
  green: '#8BC34A', // zielen marki Pulsa
  red: '#EF4444',
};

const TOAST_BODY_MAX = 120;

/** Pierwsza niepusta linia odpowiedzi bez ozdobnikow markdownu — tresc dymka. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
  const clean = line.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+)/, '').replace(/[*_`]/g, '').trim();
  return clean.length > TOAST_BODY_MAX ? `${clean.slice(0, TOAST_BODY_MAX - 1)}…` : clean;
}

/** Tresc ostatniego `**Error:** …`, ktory wtyczka dokleja do odpowiedzi przy bledzie. */
export function extractErrorMessage(text: string): string {
  const matches = [...text.matchAll(/\*\*Error:\*\*\s*(.+)/g)];
  const last = matches[matches.length - 1]?.[1]?.trim();
  return last ? firstLine(last) : 'Sprawdź rozmowę';
}

/** Stany „cos sie dzieje" — dla paska zadan nierozroznialne, rozni je dopiero awatar. */
export function isBusy(kind: TurnSignal['kind']): boolean {
  return kind === 'working' || kind === 'observing' || kind === 'thinking' || kind === 'processing'
    || kind === 'speaking';
}

export function decide(signal: TurnSignal, focused: boolean, name = currentAssistantName()): NotifierDecision {
  if (focused) return { overlay: null, flash: false, toast: null };
  switch (signal.kind) {
    case 'working':
    case 'observing':
    case 'thinking':
    case 'processing':
    case 'speaking':
      return { overlay: 'orange', flash: false, toast: null };
    case 'finished':
      return {
        overlay: 'green',
        flash: true,
        toast: { title: `${name}: gotowe, sprawdź wynik`, body: firstLine(signal.text) },
      };
    case 'error':
      return { overlay: 'red', flash: true, toast: { title: 'Błąd', body: signal.message } };
    case 'waiting':
      return {
        overlay: 'green',
        flash: true,
        toast: { title: `${name} czeka na Twoją decyzję`, body: 'Pytanie albo prośba o zgodę w Claudianie' },
      };
    case 'cancelled':
      // użytkownik sam przerwal — wie o tym. Zadnego dymka ani migania, tylko cisza.
      return { overlay: null, flash: false, toast: null };
  }
}

export type TurnListener = (signal: TurnSignal | null, focused: boolean) => void;

/**
 * Po tylu milisekundach od konca tury awatar wraca do spoczynku (ustalenie
 * użytkownika, 13.09): „skonczylam" swiecilo bez konca i przestawalo cokolwiek znaczyc.
 * Kropki na pasku zadan to NIE dotyczy — ona jest jedynym sygnalem, gdy użytkownika
 * nie ma przy komputerze dluzej, i gasnie dopiero po powrocie do okna.
 */
const REST_AFTER_MS = 60_000;

const subscribers = new Set<TurnListener>();
let lastSignal: TurnSignal | null = null;
let lastFocused = true;
let restTimer: number | null = null;

function cancelRest(): void {
  if (restTimer === null) return;
  window.clearTimeout(restTimer);
  restTimer = null;
}

/** Stany, ktore sa koncem czegos — tylko one same z siebie cichna. */
function settles(kind: TurnSignal['kind']): boolean {
  return kind === 'finished' || kind === 'cancelled';
}

function scheduleRest(): void {
  cancelRest();
  restTimer = window.setTimeout(() => {
    restTimer = null;
    if (shared) shared.rest();
    else emitTurn(null, lastFocused);
  }, REST_AFTER_MS);
}

function emitTurn(signal: TurnSignal | null, focused: boolean): void {
  lastSignal = signal;
  lastFocused = focused;
  for (const fn of subscribers) {
    try {
      fn(signal, focused);
    } catch {
      // Podglad stanu nie moze przewrocic tury.
    }
  }
}

/**
 * Awatar w naglowku rozmowy i plywajace okno na pulpicie czytaja dokladnie
 * ten sam sygnal co kropka na pasku zadan — jedno zrodlo stanu Ari.
 * Nowy sluchacz dostaje biezacy stan od razu, zeby nie czekal na kolejna ture.
 */
export function subscribeTurn(listener: TurnListener): () => void {
  subscribers.add(listener);
  ensureShared();
  try {
    listener(lastSignal, lastFocused);
  } catch {
    // Ten sam warunek co w `emitTurn`: padniety sluchacz nie moze przewrocic
    // tego, kto go wlasnie zapisal (naglowek rozmowy buduje sie w tym miejscu).
  }
  // Karta otwarta juz PO skonczonej turze zastalaby „skonczylam" na zawsze.
  if (lastSignal !== null && settles(lastSignal.kind) && restTimer === null) scheduleRest();
  return () => {
    subscribers.delete(listener);
  };
}

export interface WindowAdapter {
  isFocused(): boolean;
  setOverlay(color: OverlayColor | null): void;
  flash(on: boolean): void;
  toast(title: string, body: string): void;
  onFocusChange(listener: (focused: boolean) => void): () => void;
}

export class TurnNotifier {
  private busy = false;
  private detach: (() => void) | null = null;
  private last: TurnSignal | null = null;

  constructor(
    private readonly adapter: WindowAdapter,
    private readonly onChange: TurnListener | null = null,
  ) {
    this.detach = adapter.onFocusChange(focused => this.handleFocusChange(focused));
  }

  signal(signal: TurnSignal): void {
    this.busy = isBusy(signal.kind);
    this.last = signal;
    const focused = this.adapter.isFocused();
    const decision = decide(signal, focused);
    this.adapter.setOverlay(decision.overlay);
    this.adapter.flash(decision.flash);
    if (decision.toast) this.adapter.toast(decision.toast.title, decision.toast.body);
    this.onChange?.(signal, focused);
  }

  /**
   * Awatar wraca do spoczynku, ale nakladka na ikonie zostaje nietknieta —
   * dopiero powrot do okna ja zdejmuje.
   */
  rest(): void {
    this.busy = false;
    this.last = null;
    this.onChange?.(null, this.adapter.isFocused());
  }

  private handleFocusChange(focused: boolean): void {
    if (focused) {
      // użytkownik wrocil do okna — sygnal spelnil zadanie.
      this.adapter.setOverlay(null);
      this.adapter.flash(false);
    } else if (this.busy) {
      this.adapter.setOverlay('orange');
    }
    this.onChange?.(this.last, focused);
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }
}

interface ElectronWindow {
  isFocused(): boolean;
  flashFrame(flag: boolean): void;
  setOverlayIcon(image: unknown, description: string): void;
  show(): void;
  focus(): void;
}

interface ElectronNotification {
  on(event: 'click' | 'failed', listener: (...args: unknown[]) => void): void;
  show(): void;
}

interface ElectronRemote {
  getCurrentWindow(): ElectronWindow;
  nativeImage: { createFromDataURL(dataUrl: string): unknown };
  app?: { setAppUserModelId?(id: string): void };
  Notification?: new (options: { title: string; body: string; silent?: boolean }) => ElectronNotification;
}

/**
 * Bez tego Windows odrzuca dymek: „Settings prevent the notification type from being
 * delivered”. Proces Obsidiana startuje bez identyfikatora aplikacji, a skrot w menu
 * Start ma `md.obsidian` — dopiero zgodnosc obu pozwala dostarczyc powiadomienie
 * (zmierzone 12.09 w konsoli użytkownika).
 */
const APP_USER_MODEL_ID = 'md.obsidian';

function overlayDataUrl(color: string): string {
  const canvas = createEl('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.beginPath();
  ctx.arc(8, 8, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#1e1e1e';
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

/** Adapter na okno Obsidiana; null poza Electronem (testy, mobilny Obsidian). */
export function createElectronWindowAdapter(): WindowAdapter | null {
  let remote: ElectronRemote | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
    remote = (require('electron') as { remote?: ElectronRemote }).remote;
  } catch {
    return null;
  }
  const win = remote?.getCurrentWindow?.();
  if (!remote || !win) return null;
  try {
    remote.app?.setAppUserModelId?.(APP_USER_MODEL_ID);
  } catch {
    // Brak metody w starszym Obsidianie — dymek po prostu sie nie pokaze.
  }
  const images = new Map<OverlayColor, unknown>();

  return {
    isFocused: () => win.isFocused(),
    setOverlay: (color) => {
      if (!color) {
        win.setOverlayIcon(null, '');
        return;
      }
      if (!images.has(color)) images.set(color, remote.nativeImage.createFromDataURL(overlayDataUrl(TURN_COLORS[color])));
      win.setOverlayIcon(images.get(color), `${currentAssistantName()}: ${color}`);
    },
    flash: (on) => win.flashFrame(on),
    toast: (title, body) => {
      const raise = () => {
        win.show();
        win.focus();
      };
      // Droga procesu glownego dziala po ustawieniu identyfikatora; okno zostaje jako zapas.
      if (remote.Notification) {
        // Bez dzwieku — użytkownik slucha na sluchawkach, a dzwieku nie wybral.
        const native = new remote.Notification({ title, body, silent: true });
        native.on('click', raise);
        native.show();
        return;
      }
      if (typeof Notification === 'undefined') return;
      const fallback = new Notification(title, { body, silent: true });
      fallback.onclick = raise;
    },
    onFocusChange: (listener) => {
      const onFocus = () => listener(true);
      const onBlur = () => listener(false);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      return () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      };
    },
  };
}

let shared: TurnNotifier | null | undefined;

function ensureShared(): void {
  if (shared !== undefined) return;
  const adapter = createElectronWindowAdapter();
  shared = adapter ? new TurnNotifier(adapter, emitTurn) : null;
  if (adapter) lastFocused = adapter.isFocused();
}

/**
 * Sygnal z wnetrza tury. Fragmenty strumienia lecą setkami na ture, wiec
 * przepuszczamy wylacznie ZMIANE stanu — inaczej awatar przerysowywalby sie
 * przy kazdym kawalku tekstu.
 */
export function notifyActivity(signal: TurnSignal): void {
  if (lastSignal?.kind === signal.kind) return;
  notifyTurn(signal);
}

/** Jeden na okno — kilka kart rozmow dzieli ten sam pasek zadan. */
export function notifyTurn(signal: TurnSignal): void {
  try {
    ensureShared();
    // Kazdy nowy sygnal uniewaznia zaplanowany powrot do spoczynku.
    cancelRest();
    // Poza Electronem paska zadan nie ma, ale awatar w pasku ma dzialac dalej.
    if (shared) shared.signal(signal);
    else emitTurn(signal, lastFocused);
    // Zegar sluzy wylacznie awatarowi. Bez sluchaczy (joby, testy, mobilny
    // Obsidian) nie ma czego gasic — i nie zawieszamy minutowego timera po nic.
    if (settles(signal.kind) && subscribers.size > 0) scheduleRest();
  } catch {
    // Powiadomienie to wygoda — blad tutaj (tez przy tworzeniu adaptera) nie moze zepsuc tury.
    shared ??= null;
  }
}
