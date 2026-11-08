import {
  countLines,
  expandPastedText,
  PASTE_COLLAPSE_MIN_LINES,
  registerPastedText,
  shouldCollapsePaste,
} from '@/utils/pastedText';
import { linesLabel } from '@/utils/polishPlural';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `linia ${i}`).join('\n');

describe('polishPlural.linesLabel', () => {
  it.each([
    [1, '1 linia'], [2, '2 linie'], [4, '4 linie'], [5, '5 linii'], [12, '12 linii'],
    [14, '14 linii'], [22, '22 linie'], [25, '25 linii'], [30, '30 linii'], [104, '104 linie'], [112, '112 linii'],
  ])('%i → %s', (n, label) => {
    expect(linesLabel(n)).toBe(label);
  });
});

describe('pastedText', () => {
  it('liczy linie niezależnie od CRLF i końcowego entera', () => {
    expect(countLines('a\r\nb\r\nc\r\n')).toBe(3);
    expect(countLines('jedna')).toBe(1);
  });

  it('zwija dopiero od progu', () => {
    expect(shouldCollapsePaste(lines(PASTE_COLLAPSE_MIN_LINES - 1))).toBe(false);
    expect(shouldCollapsePaste(lines(PASTE_COLLAPSE_MIN_LINES))).toBe(true);
  });

  it('znacznik rozwija się w pełną treść, a kolejne wklejki mają własne numery', () => {
    const owner = {};
    const first = registerPastedText(owner, lines(40));
    const second = registerPastedText(owner, lines(32));

    expect(first).toBe('[Wklejony tekst #1 · 40 linii]');
    expect(second).toBe('[Wklejony tekst #2 · 32 linie]');
    expect(expandPastedText(owner, `zobacz ${first} i ${second}`))
      .toBe(`zobacz ${lines(40)} i ${lines(32)}`);
  });

  it('nie rusza tekstu bez rejestru, nieznanego numeru ani bez właściciela', () => {
    const owner = {};
    registerPastedText(owner, lines(30));

    expect(expandPastedText({}, '[Wklejony tekst #1 · 30 linii]')).toBe('[Wklejony tekst #1 · 30 linii]');
    expect(expandPastedText(owner, '[Wklejony tekst #9 · 30 linii]')).toBe('[Wklejony tekst #9 · 30 linii]');
    expect(expandPastedText(null, 'zwykły tekst')).toBe('zwykły tekst');
  });

  it('tekst ze znakami $ we wklejce trafia dosłownie', () => {
    const owner = {};
    const tricky = `${lines(29)}\ncena $1 i $& zostaje`;
    const placeholder = registerPastedText(owner, tricky);

    expect(expandPastedText(owner, placeholder)).toBe(tricky);
  });
});
