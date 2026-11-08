import { setIcon } from 'obsidian';

import {
  licznik,
  nastepneTrafienie,
  pozycjaPrzewiniecia,
  znajdzPozycje,
} from '../ui/conversationFind';

/**
 * Pasek „szukaj w rozmowie" — Ctrl+F w panelu czatu.
 *
 * Podswietla przez Highlight API (`CSS.highlights`), a NIE przez wstawianie `<mark>`:
 * mutowanie wyrenderowanego markdownu psulo by bloki kodu i gryzlo sie ze strumieniowaniem
 * odpowiedzi. Chromium w Obsidianie to 142, wiec API jest dostepne; gdyby go zabraklo,
 * pasek dalej przewija do trafien, tylko bez koloru.
 */

const NAZWA_TLA = 'claudian-find';
const NAZWA_BIEZACEGO = 'claudian-find-current';

interface Dopasowanie {
  readonly wezel: Text;
  readonly od: number;
  readonly do_: number;
}

type RejestrPodswietlen = Map<string, unknown> & {
  set(nazwa: string, podswietlenie: unknown): RejestrPodswietlen;
  delete(nazwa: string): boolean;
};

/** `CSS.highlights` bez deklaracji w lib.dom tej wersji TypeScriptu. */
function rejestr(): RejestrPodswietlen | null {
  const css = (window as { CSS?: { highlights?: RejestrPodswietlen } }).CSS;
  return css?.highlights ?? null;
}

/** `null`, gdy przegladarka nie zna `Highlight` — wtedy zostaje samo przewijanie. */
function utworzPodswietlenie(zakresy: Range[]): unknown {
  const Konstruktor = (window as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!Konstruktor) return null;
  return new Konstruktor(...zakresy);
}

/**
 * Czy element jest RENDEROWANY. Zwiniete wywolania narzedzi i diffy zostaja w DOM,
 * wiec bez tego licznik pokazywal trafienia, do ktorych nie da sie przewinac
 * (zmierzone 15.09: `claudian-tool-bash-command`, `claudian-tool-line`,
 * `claudian-tool-truncated`, `claudian-diff-text` — wszystkie rect 0x0).
 * Cache per rodzic: wiele trafien dzieli jeden element, layout mierzymy raz.
 */
function renderowany(el: Element | null, cache: Map<Element, boolean>): boolean {
  if (!el) return false;
  const znane = cache.get(el);
  if (znane !== undefined) return znane;
  // `getClientRects()` zamiast `offsetParent` — dziala tez dla SVG i elementow inline.
  const wynik = typeof el.getClientRects === 'function' ? el.getClientRects().length > 0 : true;
  cache.set(el, wynik);
  return wynik;
}

export class ConversationFindBar {
  private barEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private licznikEl: HTMLElement | null = null;
  private dopasowania: Dopasowanie[] = [];
  private biezace = -1;
  private otwarty = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly messagesEl: () => HTMLElement | null,
  ) {}

  /** Otwiera pasek albo — gdy juz otwarty — zaznacza jego zawartosc do nadpisania. */
  open(): void {
    if (!this.barEl) this.build();
    this.otwarty = true;
    this.barEl?.removeClass('claudian-find-hidden');
    this.inputEl?.focus();
    this.inputEl?.select();
  }

  close(): void {
    this.otwarty = false;
    this.barEl?.addClass('claudian-find-hidden');
    this.wyczyscPodswietlenia();
    this.dopasowania = [];
    this.biezace = -1;
    this.odswiezLicznik();
  }

  get isOpen(): boolean {
    return this.otwarty;
  }

  destroy(): void {
    this.wyczyscPodswietlenia();
    this.barEl?.remove();
    this.barEl = null;
    this.inputEl = null;
    this.licznikEl = null;
    this.dopasowania = [];
  }

  /** Ponowne przeliczenie — wolane po zmianie tresci rozmowy. */
  refresh(): void {
    if (!this.otwarty) return;
    this.szukaj(this.inputEl?.value ?? '', { zachowajPozycje: true });
  }

  private build(): void {
    const bar = this.host.createDiv({ cls: 'claudian-find-bar claudian-find-hidden' });
    this.barEl = bar;

    const input = bar.createEl('input', {
      cls: 'claudian-find-input',
      attr: { type: 'text', placeholder: 'Szukaj w rozmowie', 'aria-label': 'Szukaj w rozmowie' },
    });
    this.inputEl = input;
    input.addEventListener('input', () => this.szukaj(input.value));
    input.addEventListener('keydown', (event) => this.klawisz(event));

    this.licznikEl = bar.createSpan({ cls: 'claudian-find-count' });

    const przycisk = (ikona: string, etykieta: string, akcja: () => void): void => {
      const el = bar.createEl('button', {
        cls: 'claudian-find-button',
        attr: { type: 'button', 'aria-label': etykieta, title: etykieta },
      });
      setIcon(el, ikona);
      el.addEventListener('click', (event) => {
        event.preventDefault();
        akcja();
      });
    };
    przycisk('chevron-up', 'Poprzednie (Shift+Enter)', () => this.skocz(true));
    przycisk('chevron-down', 'Następne (Enter)', () => this.skocz(false));
    przycisk('x', 'Zamknij (Esc)', () => this.close());
  }

  private klawisz(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      this.messagesEl()?.focus?.();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.skocz(event.shiftKey);
      return;
    }
    // Strzalki chodza po trafieniach — w jednoliniowym polu i tak nie ruszaja kursora.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.skocz(event.key === 'ArrowUp');
    }
  }

  private szukaj(fraza: string, opcje?: { zachowajPozycje?: boolean }): void {
    const poprzednie = this.biezace;
    this.dopasowania = this.zbierzDopasowania(fraza);
    this.biezace = this.dopasowania.length === 0
      ? -1
      : opcje?.zachowajPozycje && poprzednie >= 0
        ? Math.min(poprzednie, this.dopasowania.length - 1)
        : 0;
    this.maluj();
    this.odswiezLicznik();
    if (!opcje?.zachowajPozycje) this.przewinDoBiezacego();
  }

  /**
   * Tekst calej rozmowy z mapa pozycji na wezly, zeby trafienie moglo przechodzic
   * przez granice elementow — inaczej fraza z pogrubionym slowem w srodku nie znalazlaby sie.
   */
  private zbierzDopasowania(fraza: string): Dopasowanie[] {
    const root = this.messagesEl();
    if (!root) return [];
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const wezly: Text[] = [];
    const poczatki: number[] = [];
    const widocznosc = new Map<Element, boolean>();
    let calosc = '';
    let wezel = walker.nextNode() as Text | null;
    while (wezel) {
      const tekst = wezel.data;
      if (tekst && renderowany(wezel.parentElement, widocznosc)) {
        wezly.push(wezel);
        poczatki.push(calosc.length);
        calosc += tekst;
      }
      wezel = walker.nextNode() as Text | null;
    }

    const dlugosc = fraza.trim().length;
    const out: Dopasowanie[] = [];
    for (const pozycja of znajdzPozycje(calosc, fraza)) {
      const i = this.wezelDla(poczatki, pozycja);
      if (i < 0) continue;
      const wezel = wezly[i];
      const od = pozycja - poczatki[i];
      // ponytail: trafienie siegajace przez granice wezlow (fraza z pogrubionym slowem
      // w srodku) podswietlamy tylko w pierwszym z nich. Szukanie i przewijanie dziala
      // dla calej frazy — docina sie wylacznie kolor. Laczenie Range'ow nie jest tego warte.
      out.push({ wezel, od, do_: Math.min(od + dlugosc, wezel.data.length) });
    }
    return out;
  }

  /** Indeks wezla, w ktorym leży dana pozycja w sklejonym tekscie (wyszukiwanie binarne). */
  private wezelDla(poczatki: number[], pozycja: number): number {
    let lo = 0;
    let hi = poczatki.length - 1;
    let wynik = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (poczatki[mid] <= pozycja) {
        wynik = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return wynik;
  }

  private zakres(d: Dopasowanie): Range | null {
    const doc = this.messagesEl()?.ownerDocument;
    if (!doc) return null;
    const range = doc.createRange();
    try {
      range.setStart(d.wezel, Math.min(d.od, d.wezel.data.length));
      range.setEnd(d.wezel, Math.min(d.do_, d.wezel.data.length));
    } catch {
      return null;
    }
    return range;
  }

  private maluj(): void {
    const reg = rejestr();
    if (!reg) return;
    const zakresy = this.dopasowania.map(d => this.zakres(d)).filter((r): r is Range => r !== null);
    const tlo = utworzPodswietlenie(zakresy);
    if (tlo) reg.set(NAZWA_TLA, tlo);
    const biezacy = this.biezace >= 0 ? this.zakres(this.dopasowania[this.biezace]) : null;
    const wyroznione = biezacy ? utworzPodswietlenie([biezacy]) : null;
    if (wyroznione) reg.set(NAZWA_BIEZACEGO, wyroznione);
    else reg.delete(NAZWA_BIEZACEGO);
  }

  private wyczyscPodswietlenia(): void {
    const reg = rejestr();
    reg?.delete(NAZWA_TLA);
    reg?.delete(NAZWA_BIEZACEGO);
  }

  private skocz(wstecz: boolean): void {
    this.biezace = nastepneTrafienie(this.biezace, this.dopasowania.length, wstecz);
    this.maluj();
    this.odswiezLicznik();
    this.przewinDoBiezacego();
  }

  private przewinDoBiezacego(): void {
    if (this.biezace < 0) return;
    const kontener = this.messagesEl();
    if (!kontener) return;
    const d = this.dopasowania[this.biezace];
    const trafienie = this.zakres(d)?.getBoundingClientRect();
    if (trafienie && (trafienie.height > 0 || trafienie.width > 0)) {
      const k = kontener.getBoundingClientRect();
      const top = pozycjaPrzewiniecia(
        kontener.scrollTop,
        k.top,
        k.height,
        trafienie.top,
        trafienie.height,
      );
      // ponytail: bez `smooth` — przy rozmowie na 200 000 px animacja nie dojezdza
      // do celu, zanim padnie nastepny skok. Szukanie ma trafiac od razu.
      kontener.scrollTop = top;
      return;
    }
    // ponytail: Range bez wymiarow (wezel chwilowo ukryty) — zostaje stara droga.
    d.wezel.parentElement?.scrollIntoView({ block: 'center' });
  }

  private odswiezLicznik(): void {
    if (!this.licznikEl) return;
    this.licznikEl.setText(licznik(this.biezace, this.dopasowania.length, this.inputEl?.value ?? ''));
  }
}
