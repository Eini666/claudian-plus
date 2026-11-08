import {
  buildPromptSuggestionPrompt,
  buildPromptSuggestionSystemPrompt,
  parsePromptSuggestionResponse,
} from '../../../../src/core/prompt/promptSuggestion';

describe('parsePromptSuggestionResponse', () => {
  it('zwraca czysty tekst pierwszej linii', () => {
    expect(parsePromptSuggestionResponse('Wgraj to na serwer\n')).toBe('Wgraj to na serwer');
  });

  it('bierze pierwsza NIEPUSTA linie i odrzuca warianty ponizej', () => {
    expect(parsePromptSuggestionResponse('\n\nPokaz diff\nAlbo: odpal testy'))
      .toBe('Pokaz diff');
  });

  it('zdejmuje cudzyslowy i znaczniki listy', () => {
    expect(parsePromptSuggestionResponse('"Odpal testy"')).toBe('Odpal testy');
    expect(parsePromptSuggestionResponse('- Odpal testy')).toBe('Odpal testy');
    expect(parsePromptSuggestionResponse('1. Odpal testy')).toBe('Odpal testy');
  });

  it('ucina doklejone wyjasnienie po mysliku', () => {
    expect(parsePromptSuggestionResponse('Wklej sugestie — takiej, kiedy model zignoruje'))
      .toBe('Wklej sugestie');
    expect(parsePromptSuggestionResponse('Commituj - ale najpierw odpal testy'))
      .toBe('Commituj');
    expect(parsePromptSuggestionResponse('Zrob e-mail')).toBe('Zrob e-mail');
  });

  it('NONE i pustka daja null', () => {
    expect(parsePromptSuggestionResponse('NONE')).toBeNull();
    expect(parsePromptSuggestionResponse('none')).toBeNull();
    expect(parsePromptSuggestionResponse('   \n  ')).toBeNull();
    expect(parsePromptSuggestionResponse('""')).toBeNull();
  });

  it('tnie przydluga odpowiedz', () => {
    const wynik = parsePromptSuggestionResponse('x'.repeat(200));
    expect(wynik).toHaveLength(120);
    expect(wynik?.endsWith('…')).toBe(true);
  });
});

describe('buildPromptSuggestionPrompt', () => {
  it('zostawia KONIEC odpowiedzi, bo tam stoi nastepny krok', () => {
    const dlugi = `${'a'.repeat(2000)}KONIEC`;
    const prompt = buildPromptSuggestionPrompt(dlugi);
    expect(prompt).toContain('KONIEC');
    expect(prompt).toContain('...');
    expect(prompt.length).toBeLessThan(1700);
  });

  it('krotka odpowiedz idzie w calosci', () => {
    expect(buildPromptSuggestionPrompt('  Gotowe.  ')).toContain('"""\nGotowe.\n"""');
  });
});

describe('buildPromptSuggestionSystemPrompt', () => {
  it('wstawia jezyk z locale', () => {
    expect(buildPromptSuggestionSystemPrompt('pl')).toContain('Polish');
    expect(buildPromptSuggestionSystemPrompt()).toContain('English');
  });
});
