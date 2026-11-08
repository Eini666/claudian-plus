import {
  formatQuote,
  formatStamp,
  QUOTE_ID_CHARS,
  quoteAnchor,
  quoteHeader,
  resourceNote,
  safeNoteName,
  scratchpadEntry,
  slugify,
  titleFromSelection,
} from '@/utils/selectionActions';

const DATE = new Date(2026, 8, 11, 17, 5);

describe('selectionActions', () => {
  it('formatStamp daje polski zapis daty z zerami', () => {
    expect(formatStamp(new Date(2026, 0, 3, 9, 7))).toBe('03.01.2026 09:07');
  });

  describe('formatQuote', () => {
    it('cytuje kazda linie i zostawia miejsce na odpowiedz', () => {
      expect(formatQuote('pierwsza\ndruga')).toBe('> pierwsza\n> druga\n\n');
    });

    it('pusta linia w srodku zostaje czescia cytatu', () => {
      expect(formatQuote('a\n\nb')).toBe('> a\n>\n> b\n\n');
    });
  });

  describe('titleFromSelection', () => {
    it('bierze pierwsza niepusta linie bez ozdobnikow markdownu', () => {
      expect(titleFromSelection('\n## **Przełącznik** kont\nreszta')).toBe('Przełącznik kont');
      expect(titleFromSelection('- [link](http://x) na liście')).toBe('link na liście');
    });

    it('tnie dlugi tytul na granicy slowa', () => {
      const title = titleFromSelection('słowo '.repeat(20), 30);
      expect(title.endsWith('…')).toBe(true);
      expect(title.length).toBeLessThanOrEqual(31);
      expect(title).not.toMatch(/\s…$/);
    });

    it('ma zapasowy tytul dla samych bialych znakow', () => {
      expect(titleFromSelection('   \n  ')).toBe('Fragment rozmowy');
    });
  });

  describe('slugify', () => {
    it('zamienia polskie znaki i interpunkcje na kebab-case ASCII', () => {
      expect(slugify('Żółć gęślą: jaźń — test!')).toBe('zolc-gesla-jazn-test');
    });

    it('nie konczy sie myslnikiem po przycieciu i ma zapas dla pustego', () => {
      expect(slugify('abc def ghi', 5)).toBe('abc-d');
      expect(slugify('abcd efgh', 5)).toBe('abcd');
      expect(slugify('!!!')).toBe('fragment-rozmowy');
    });
  });

  it('safeNoteName usuwa znaki niedozwolone w nazwie pliku', () => {
    expect(safeNoteName('a/b: c?"d"#^[x]…')).toBe('a b c d x');
  });

  it('wpis Brudnopisu jest oddzielony i datowany', () => {
    expect(scratchpadEntry('  tekst  ', DATE)).toBe('\n\n---\n*Z rozmowy · 11.09.2026 17:05*\n\ntekst\n');
  });

  it('notatka w Zasobach ma tytul, zrodlo i tresc', () => {
    expect(resourceNote('tekst', 'Tytuł', DATE)).toBe('# Tytuł\n\n*Z rozmowy w Claudianie · 11.09.2026 17:05*\n\ntekst\n');
  });
});
describe('cytat z odniesieniem do wiadomosci zrodlowej', () => {
  it('bez zrodla zostaje golym cytatem — tak jak przed 15.09', () => {
    expect(formatQuote('zdanie')).toBe('> zdanie\n\n');
    expect(formatQuote('zdanie', {})).toBe('> zdanie\n\n');
  });

  it('dokleja autora i skrocony identyfikator', () => {
    const wynik = formatQuote('zdanie', { id: 'a1b2c3d4e5f6', role: 'assistant' }, 'Ari');
    expect(wynik).toBe('> [Ari · msg a1b2c3d4]\n> zdanie\n\n');
  });

  it('rozroznia autora', () => {
    expect(quoteHeader({ role: 'user', id: 'ffffffffffff' }, 'Ari')).toBe('> [Ty · msg ffffffff]');
    expect(quoteHeader({ role: 'assistant', id: 'ffffffffffff' }, 'Ari')).toBe('> [Ari · msg ffffffff]');
  });

  it('asystent bez ustawionej nazwy albo z pusta nazwa to Claude, nigdy pusty napis', () => {
    expect(quoteHeader({ role: 'assistant', id: 'ffffffffffff' })).toBe('> [Claude · msg ffffffff]');
    expect(quoteHeader({ role: 'assistant' }, '')).toBe('> [Claude]');
    expect(quoteHeader({ role: 'assistant' }, '   ')).toBe('> [Claude]');
    expect(quoteHeader({ role: 'assistant' }, '  Jarvis ')).toBe('> [Jarvis]');
  });

  it('radzi sobie z polowa danych', () => {
    expect(quoteHeader({ role: 'assistant' }, 'Ari')).toBe('> [Ari]');
    expect(quoteHeader({ id: 'abcdefgh12' })).toBe('> [msg abcdefgh]');
  });

  it('milczy, gdy nie ma czego podac — w tym przy nieznanej roli', () => {
    expect(quoteHeader()).toBeNull();
    expect(quoteHeader({})).toBeNull();
    expect(quoteHeader({ id: '   ' })).toBeNull();
    expect(quoteHeader({ role: 'system' })).toBeNull();
  });

  it('naglowek jest czescia cytatu, wiec nie psuje bloku', () => {
    const wynik = formatQuote('pierwsza\n\ndruga', { id: 'abcdefgh', role: 'user' });
    expect(wynik.split('\n').filter(Boolean).every(l => l.startsWith('>'))).toBe(true);
  });

  it('skrot ma umowiona dlugosc', () => {
    expect(QUOTE_ID_CHARS).toBe(8);
  });
});
describe('kotwica bierze rozrozniajaca czesc identyfikatora', () => {
  it('z identyfikatora Claudiana bierze ogon, bo poczatek jest wspolny', () => {
    // Zmierzone na 235 prawdziwych: pierwsze 8 znakow = 2 unikalne, ogon = 235.
    expect(quoteAnchor('msg-1789050511497-0dr2kxe')).toBe('0dr2kxe');
    expect(quoteAnchor('msg-1788980798732-6jb64mc')).toBe('6jb64mc');
  });

  it('dwa rozne identyfikatory daja rozne kotwice', () => {
    const a = quoteAnchor('msg-1789050511497-0dr2kxe');
    const b = quoteAnchor('msg-1789050511498-zzzzzzz');
    expect(a).not.toBe(b);
  });

  it('bez segmentow bierze poczatek', () => {
    expect(quoteAnchor('a1b2c3d4e5f6')).toBe('a1b2c3d4');
  });

  it('pusty identyfikator nie daje kotwicy', () => {
    expect(quoteAnchor()).toBe('');
    expect(quoteAnchor('   ')).toBe('');
  });

  it('naglowek uzywa ogona', () => {
    expect(quoteHeader({ role: 'assistant', id: 'msg-1789050511497-0dr2kxe' }, 'Ari'))
      .toBe('> [Ari · msg 0dr2kxe]');
  });
});
