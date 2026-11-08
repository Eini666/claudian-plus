import type { App, ItemView, WorkspaceLeaf } from 'obsidian';

import type { BrowserSelectionContext } from '../../../utils/browser';
import type { ComposerContextTray } from '../ui/ComposerContextTray';

const BROWSER_SELECTION_POLL_INTERVAL = 250;

type BrowserLikeWebview = HTMLElement & {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
};

export class BrowserSelectionController {
  private app: App;
  private contextTray: ComposerContextTray;
  private inputEl: HTMLElement;
  private onVisibilityChange: (() => void) | null;
  private onUserSelectionChanged: (() => void) | null;
  private storedSelection: BrowserSelectionContext | null = null;
  private pollInterval: number | null = null;
  private pollInFlight = false;
  /** Tekst juz wyslany albo zamkniety krzyzykiem — nie lapac go ponownie, dopoki zaznaczenie sie nie zmieni. */
  private dismissedText: string | null = null;

  constructor(
    app: App,
    contextTray: ComposerContextTray,
    inputEl: HTMLElement,
    onVisibilityChange?: () => void,
    onUserSelectionChanged?: () => void,
  ) {
    this.app = app;
    this.contextTray = contextTray;
    this.inputEl = inputEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
    this.onUserSelectionChanged = onUserSelectionChanged ?? null;
  }

  start(): void {
    if (this.pollInterval) return;
    this.pollInterval = window.setInterval(() => {
      void this.poll();
    }, BROWSER_SELECTION_POLL_INTERVAL);
  }

  stop(): void {
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.clear();
  }

  private async poll(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const { views, activeIsBrowser } = this.getBrowserViews();
      // Brak widocznej przegladarki (np. przelaczenie na karte Claudiana) NIE kasuje
      // zapamietanego zaznaczenia. Upstream czyscil tu, zanim kursor zdazyl stanac
      // w polu czatu, wiec przy zakladkach na srodku funkcja nigdy nie dzialala (11.09).
      for (const browserView of views) {
        const selectedText = await this.extractSelectedText(browserView.containerEl);
        if (!selectedText) continue;
        if (selectedText === this.dismissedText) return;
        this.dismissedText = null;
        const nextContext = this.buildContext(browserView.view, browserView.viewType, browserView.containerEl, selectedText);
        if (!this.isSameSelection(nextContext, this.storedSelection)) {
          this.storedSelection = nextContext;
          this.updateIndicator();
          this.onUserSelectionChanged?.();
        }
        return;
      }
      // Czyscimy tylko, gdy odznaczenie widac w przegladarce, ktora wlasnie ma fokus.
      if (activeIsBrowser) {
        this.dismissedText = null;
        this.clearWhenInputIsNotFocused();
      }
    } catch {
      // Ignore transient polling errors to keep selection tracking resilient.
    } finally {
      this.pollInFlight = false;
    }
  }

  private getActiveBrowserView(): { view: ItemView; viewType: string; containerEl: HTMLElement } | null {
    return this.toBrowserView(this.app.workspace.getMostRecentLeaf?.() ?? null, true);
  }

  /**
   * Ostatnio aktywna karta srodka + kazda WIDOCZNA przegladarka gdzie indziej.
   * `getMostRecentLeaf()` z definicji pomija panele boczne, wiec przegladarka
   * obok czatu w panelu byla dla wtyczki niewidzialna.
   */
  private getBrowserViews(): {
    views: { view: ItemView; viewType: string; containerEl: HTMLElement }[];
    activeIsBrowser: boolean;
  } {
    const active = this.getActiveBrowserView();
    const views = active ? [active] : [];
    this.app.workspace.iterateAllLeaves?.((leaf) => {
      const candidate = this.toBrowserView(leaf, false);
      if (candidate && candidate.view !== active?.view && this.isShown(candidate.containerEl)) {
        views.push(candidate);
      }
    });
    return { views, activeIsBrowser: active !== null };
  }

  private toBrowserView(
    leaf: WorkspaceLeaf | null,
    allowIframeFallback: boolean,
  ): { view: ItemView; viewType: string; containerEl: HTMLElement } | null {
    const view = leaf?.view as ItemView | undefined;
    const containerEl = (view as unknown as { containerEl?: HTMLElement } | undefined)?.containerEl;
    if (!view || !containerEl) return null;
    const viewType = view.getViewType?.() ?? '';
    // Poza aktywna karta tylko po typie widoku — iframe ma tez zwykla notatka z osadzonym filmem.
    const browserLike = allowIframeFallback
      ? this.isBrowserLikeView(viewType, containerEl)
      : /surfing|browser|webview/i.test(viewType);
    return browserLike ? { view, viewType, containerEl } : null;
  }

  private isShown(el: HTMLElement): boolean {
    const obsidianEl = el as HTMLElement & { isShown?: () => boolean };
    return obsidianEl.isShown ? obsidianEl.isShown() : el.offsetParent !== null;
  }

  private isBrowserLikeView(viewType: string, containerEl: HTMLElement): boolean {
    const normalized = viewType.toLowerCase();
    if (
      normalized.includes('surfing')
      || normalized.includes('browser')
      || normalized.includes('webview')
    ) {
      return true;
    }

    return Boolean(containerEl.querySelector('iframe, webview'));
  }

  private async extractSelectedText(containerEl: HTMLElement): Promise<string | null> {
    const ownerDoc = containerEl.ownerDocument;
    const docSelection = this.extractSelectionFromDocument(ownerDoc, containerEl);
    if (docSelection) return docSelection;

    const frameSelection = this.extractSelectionFromIframes(containerEl);
    if (frameSelection) return frameSelection;

    return await this.extractSelectionFromWebviews(containerEl);
  }

  private extractSelectionFromDocument(doc: Document, scopeEl: HTMLElement): string | null {
    const selection = doc.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText) {
      const anchorNode = selection?.anchorNode;
      const focusNode = selection?.focusNode;
      if ((anchorNode && scopeEl.contains(anchorNode)) || (focusNode && scopeEl.contains(focusNode))) {
        return selectedText;
      }
    }

    return this.extractSelectionFromActiveInput(doc, scopeEl);
  }

  private extractSelectionFromActiveInput(doc: Document, scopeEl: HTMLElement): string | null {
    const activeEl = doc.activeElement;
    if (!activeEl || !scopeEl.contains(activeEl)) return null;

    if (activeEl.instanceOf(HTMLTextAreaElement) || activeEl.instanceOf(HTMLInputElement)) {
      const { value, selectionStart, selectionEnd } = activeEl;
      if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number' || selectionStart === selectionEnd) return null;
      return value.slice(selectionStart, selectionEnd).trim() || null;
    }

    return null;
  }

  private extractSelectionFromIframes(containerEl: HTMLElement): string | null {
    const iframes = Array.from(containerEl.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      try {
        const frameDoc = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (!frameDoc || !frameDoc.body) continue;

        const frameSelection = this.extractSelectionFromDocument(frameDoc, frameDoc.body);
        if (frameSelection) return frameSelection;
      } catch {
        // Ignore inaccessible iframe contexts (cross-origin restrictions).
      }
    }
    return null;
  }

  private async extractSelectionFromWebviews(containerEl: HTMLElement): Promise<string | null> {
    const webviews = Array.from(containerEl.querySelectorAll<BrowserLikeWebview>('webview'));
    for (const webview of webviews) {
      if (typeof webview.executeJavaScript !== 'function') continue;
      try {
        const result = await webview.executeJavaScript(
          'window.getSelection ? window.getSelection().toString() : ""',
          true
        );
        if (typeof result === 'string' && result.trim()) {
          return result.trim();
        }
      } catch {
        // Ignore inaccessible webview contexts.
      }
    }
    return null;
  }

  private buildContext(
    view: ItemView,
    viewType: string,
    containerEl: HTMLElement,
    selectedText: string
  ): BrowserSelectionContext {
    const title = this.extractViewTitle(view);
    const url = this.extractViewUrl(view, containerEl);
    const source = url ? `browser:${url}` : `browser:${viewType || 'unknown'}`;

    return {
      source,
      selectedText,
      title,
      url,
    };
  }

  private extractViewTitle(view: ItemView): string | undefined {
    const displayText = view.getDisplayText?.();
    if (displayText?.trim()) return displayText.trim();

    const title = (view as unknown as { title?: unknown }).title;
    return typeof title === 'string' && title.trim() ? title.trim() : undefined;
  }

  private extractViewUrl(view: ItemView, containerEl: HTMLElement): string | undefined {
    const rawView = view as unknown as Record<string, unknown>;
    const directCandidates = [
      rawView.url,
      rawView.currentUrl,
      rawView.currentURL,
      rawView.src,
    ];

    for (const candidate of directCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    const embeddableEl = containerEl.querySelector<HTMLElement>('iframe[src], webview[src]');
    const embeddedSrc = embeddableEl?.getAttribute('src');
    if (embeddedSrc?.trim()) {
      return embeddedSrc.trim();
    }

    return undefined;
  }

  private isSameSelection(
    left: BrowserSelectionContext | null,
    right: BrowserSelectionContext | null
  ): boolean {
    if (!left || !right) return false;
    return left.source === right.source
      && left.selectedText === right.selectedText
      && left.title === right.title
      && left.url === right.url;
  }

  private clearWhenInputIsNotFocused(): void {
    if (this.inputEl.ownerDocument.activeElement === this.inputEl) return;
    if (this.storedSelection) {
      this.storedSelection = null;
      this.updateIndicator();
      this.onUserSelectionChanged?.();
    }
  }

  private updateIndicator(): void {
    if (this.storedSelection) {
      const lineCount = this.storedSelection.selectedText.split(/\r?\n/).length;
      const lineLabel = lineCount === 1 ? 'line' : 'lines';
      const label = `${lineCount} ${lineLabel} selected`;
      this.contextTray.setItems('browser-selection', [{
        id: 'browser-selection',
        kind: 'selection',
        label,
        icon: 'globe',
        ariaLabel: label,
        onRemove: () => {
          this.dismiss();
          this.onUserSelectionChanged?.();
        },
      }]);
    } else {
      this.contextTray.clearItems('browser-selection');
    }
    this.updateContextRowVisibility();
  }

  updateContextRowVisibility(): void {
    this.onVisibilityChange?.();
  }

  getContext(): BrowserSelectionContext | null {
    return this.storedSelection;
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  clear(): void {
    this.storedSelection = null;
    this.updateIndicator();
  }

  /**
   * Po wyslaniu wiadomosci albo kliknieciu x: zaznaczenie znika i nie wraca przy
   * nastepnym odpytaniu, choc w przegladarce nadal jest zaznaczone. Nowe zaznaczenie
   * zlapie sie normalnie.
   */
  dismiss(): void {
    this.dismissedText = this.storedSelection?.selectedText ?? null;
    this.clear();
  }
}
