import {
  MAX_PLACEHOLDER_CHARS,
  placeholderFor,
  shouldAcceptSuggestion,
  SUGGESTION_MARKER,
} from '@/features/chat/ui/promptSuggestion';

const FALLBACK = 'Ask anything';

const key = (over: Partial<Parameters<typeof shouldAcceptSuggestion>[0]> = {}) => ({
  key: 'ArrowRight',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...over,
});

describe('placeholderFor', () => {
  it('wraca wlasny placeholder pola, gdy nie ma sugestii', () => {
    expect(placeholderFor(null, FALLBACK)).toBe(FALLBACK);
    expect(placeholderFor(undefined, FALLBACK)).toBe(FALLBACK);
    expect(placeholderFor('', FALLBACK)).toBe(FALLBACK);
    expect(placeholderFor('   \n  ', FALLBACK)).toBe(FALLBACK);
  });

  it('oznacza sugestie strzalka, zeby bylo widac czym ja przyjac', () => {
    expect(placeholderFor('zbuduj i wdroz', FALLBACK)).toBe(`${SUGGESTION_MARKER}zbuduj i wdroz`);
  });

  it('sklada sugestie do jednej linii — pole rozciaga sie do value, nie do placeholdera', () => {
    expect(placeholderFor('pierwsza\n\ndruga   trzecia', FALLBACK))
      .toBe(`${SUGGESTION_MARKER}pierwsza druga trzecia`);
  });

  it('skraca dluga sugestie, ale nie wiecej niz do limitu', () => {
    const wynik = placeholderFor('x'.repeat(400), FALLBACK);
    expect(wynik.startsWith(SUGGESTION_MARKER)).toBe(true);
    expect(wynik.endsWith('…')).toBe(true);
    expect(wynik.length - SUGGESTION_MARKER.length).toBeLessThanOrEqual(MAX_PLACEHOLDER_CHARS);
  });

  it('nie skraca tego, co sie miesci', () => {
    const tekst = 'y'.repeat(MAX_PLACEHOLDER_CHARS);
    expect(placeholderFor(tekst, FALLBACK)).toBe(SUGGESTION_MARKER + tekst);
  });
});

describe('shouldAcceptSuggestion', () => {
  it('przyjmuje strzalka i tabem w pustym polu', () => {
    expect(shouldAcceptSuggestion(key({ key: 'ArrowRight' }), '', 'coś')).toBe(true);
    expect(shouldAcceptSuggestion(key({ key: 'Tab' }), '', 'coś')).toBe(true);
  });

  it('nie rusza innych klawiszy', () => {
    for (const k of ['Enter', 'ArrowLeft', 'a', 'Escape', 'ArrowDown']) {
      expect(shouldAcceptSuggestion(key({ key: k }), '', 'coś')).toBe(false);
    }
  });

  it('nie kradnie klawiszy, gdy pole nie jest puste — podpowiedzi i tak nie widac', () => {
    expect(shouldAcceptSuggestion(key(), 'a', 'coś')).toBe(false);
    expect(shouldAcceptSuggestion(key({ key: 'Tab' }), ' ', 'coś')).toBe(false);
  });

  it('nic nie robi bez sugestii', () => {
    expect(shouldAcceptSuggestion(key(), '', null)).toBe(false);
    expect(shouldAcceptSuggestion(key(), '', '   ')).toBe(false);
  });

  it('puszcza modyfikatory dalej — Shift+Tab ma wlasne znaczenie', () => {
    expect(shouldAcceptSuggestion(key({ key: 'Tab', shiftKey: true }), '', 'coś')).toBe(false);
    expect(shouldAcceptSuggestion(key({ ctrlKey: true }), '', 'coś')).toBe(false);
    expect(shouldAcceptSuggestion(key({ metaKey: true }), '', 'coś')).toBe(false);
    expect(shouldAcceptSuggestion(key({ altKey: true }), '', 'coś')).toBe(false);
  });

  it('milczy w trakcie skladania znaku (IME)', () => {
    expect(shouldAcceptSuggestion(key({ isComposing: true }), '', 'coś')).toBe(false);
  });
});
