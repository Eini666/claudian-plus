import { linesLabel } from './polishPlural';

/**
 * Dluga wklejka w polu wpisywania zamienia sie w krotki znacznik, a do modelu idzie
 * calosc — tak jak w terminalu Claude Code. Zrzut z konsoli na 120 linii nie zajmuje
 * wtedy calego pola ani dymka wiadomosci.
 */

// ponytail: staly prog; ustawienie dopiero, gdy ktos zechce inny
export const PASTE_COLLAPSE_MIN_LINES = 30;

const PLACEHOLDER = /\[Wklejony tekst #(\d+) · \d+ lini[aei]\]/g;

interface PasteStore {
  nextId: number;
  texts: Map<number, string>;
}

// ponytail: wpisy zyja do zamkniecia karty — kilka KB tekstu; bez nich cofniecie
// nieudanej wysylki do pola zostawiloby znaczniki bez tresci
const stores = new WeakMap<object, PasteStore>();

export function countLines(text: string): number {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
}

export function shouldCollapsePaste(text: string): boolean {
  return countLines(text) >= PASTE_COLLAPSE_MIN_LINES;
}

/** Zapamietuje tresc i zwraca znacznik do wstawienia w pole. */
export function registerPastedText(owner: object, text: string): string {
  let store = stores.get(owner);
  if (!store) {
    store = { nextId: 1, texts: new Map() };
    stores.set(owner, store);
  }
  const id = store.nextId++;
  store.texts.set(id, text);
  return `[Wklejony tekst #${id} · ${linesLabel(countLines(text))}]`;
}

/** Podmienia znaczniki na zapamietana tresc; nieznany znacznik zostaje doslownie. */
export function expandPastedText(owner: object | null | undefined, text: string): string {
  const store = owner ? stores.get(owner) : undefined;
  if (!store) return text;
  return text.replace(PLACEHOLDER, (placeholder, id: string) => store.texts.get(Number(id)) ?? placeholder);
}
