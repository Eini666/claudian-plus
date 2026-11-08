import type { App } from 'obsidian';

import { TOOL_EDIT, TOOL_WRITE } from '../../../core/tools/toolNames';

/**
 * Mockup obok czatu: model zapisuje plik strony, a otwarta obok karta przegladarki
 * sama sie przeladowuje — bez klikania „odswiez” po kazdej poprawce.
 * Tylko strony lokalne (XAMPP, serwer deweloperski, file://) — obcej strony nie ruszamy.
 */

const WEB_ASSET = /\.(html?|css|m?js|svg|php)$/i;
const LOCAL_URL = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)|file:\/\/)/i;
// ponytail: stale opoznienie; Edit czesto idzie seria kilku wywolan, przeladowujemy raz po ostatnim
const DEBOUNCE_MS = 400;

type ReloadableWebview = HTMLElement & { reload?: () => void; getURL?: () => string };

export function isWebAssetEdit(toolName: string, input: Record<string, unknown> | undefined): boolean {
  if (toolName !== TOOL_WRITE && toolName !== TOOL_EDIT) return false;
  const filePath = input?.file_path;
  return typeof filePath === 'string' && WEB_ASSET.test(filePath);
}

export function isLocalUrl(url: string | null | undefined): boolean {
  return !!url && LOCAL_URL.test(url.trim());
}

let timer: number | null = null;

/** Zwraca liczbe przeladowanych kart — przydatne w teście, w UI ignorowane. */
export function reloadLocalBrowsers(app: App): number {
  let reloaded = 0;
  for (const leaf of app.workspace.getLeavesOfType('webviewer')) {
    const containerEl = (leaf.view as unknown as { containerEl?: HTMLElement }).containerEl;
    const webview = containerEl?.querySelector<ReloadableWebview>('webview');
    if (!webview || typeof webview.reload !== 'function') continue;
    const url = webview.getURL?.() ?? webview.getAttribute('src');
    if (!isLocalUrl(url)) continue;
    webview.reload();
    reloaded++;
  }
  return reloaded;
}

export function scheduleLocalBrowserReload(app: App): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    try {
      reloadLocalBrowsers(app);
    } catch {
      // Przeladowanie to wygoda — blad tutaj nie moze przerwac strumienia odpowiedzi.
    }
  }, DEBOUNCE_MS);
}
