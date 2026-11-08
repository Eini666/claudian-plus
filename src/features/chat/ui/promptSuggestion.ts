/**
 * Sugestia nastepnej wiadomosci — czysta logika, bez DOM i bez Obsidiana.
 *
 * SDK po kazdej turze przewiduje, co uzytkownik napisze dalej, i przysyla to
 * wiadomoscia `prompt_suggestion` (opcja `promptSuggestions`). Sugestia jedzie
 * na cache promptu tury, ktora ja zrodzila, wiec praktycznie nic nie kosztuje.
 *
 * Pokazujemy ja jako `placeholder` pustego pola, a nie jako nakladke: placeholder
 * widac dokladnie wtedy, gdy pole jest puste — czyli wtedy, kiedy sugestia jest
 * do czegos potrzebna. Zadnego lustrzanego odbicia czcionki i przewijania
 * (użytkownik wybral ten wariant 14.09).
 */

/** Znacznik w podpowiedzi mowi, czym ja przyjac — zamiast osobnego napisu w UI. */
export const SUGGESTION_MARKER = '→ ';

/**
 * Podpowiedz w polu ma zostac JEDNOLINIJKOWA. Pole rozciaga sie do `value`,
 * nie do `placeholder`, wiec dluga sugestia zostalaby przyciete w pol slowa.
 */
export const MAX_PLACEHOLDER_CHARS = 120;

/** Tekst do pokazania w pustym polu. `null` → wraca wlasny placeholder pola. */
export function placeholderFor(
  suggestion: string | null | undefined,
  fallback: string,
): string {
  const jedna = (suggestion ?? '').replace(/\s+/g, ' ').trim();
  if (!jedna) return fallback;
  const tekst = jedna.length > MAX_PLACEHOLDER_CHARS
    ? `${jedna.slice(0, MAX_PLACEHOLDER_CHARS - 1).trimEnd()}…`
    : jedna;
  return SUGGESTION_MARKER + tekst;
}

export interface AcceptKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}

/**
 * Czy to nacisniecie przyjmuje sugestie.
 *
 * Warunek pustego pola nie jest kosmetyka: przy niepustym polu `→` przesuwa
 * kursor, a `Tab` wciaz moze komus sluzyc do wciecia. Sugestia i tak jest wtedy
 * niewidoczna (placeholder znika po pierwszej literze), wiec przejmowanie tych
 * klawiszy bylo by kradzieza zachowania, ktore uzytkownik widzi.
 */
export function shouldAcceptSuggestion(
  event: AcceptKeyEvent,
  inputValue: string,
  suggestion: string | null | undefined,
): boolean {
  if (!suggestion || !suggestion.trim()) return false;
  if (inputValue !== '') return false;
  if (event.isComposing) return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === 'ArrowRight' || event.key === 'Tab';
}
