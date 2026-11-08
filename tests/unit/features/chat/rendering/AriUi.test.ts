/**
 * @jest-environment jsdom
 */
import { chartPoints, formatValue, niceMax, parseAriUi, renderAriUi } from '@/features/chat/rendering/AriUi';

// Intl dla pl-PL rozdziela tysiace i „mln” twarda spacja (U+00A0) — liczba nie lamie sie w wezszym kafelku.
const NBSP = ' ';

const SOURCE = [
  '{"id":"r","kind":"row"}',
  '{"id":"s1","kind":"stat","parent":"r","props":{"label":"Runy","value":18}}',
  '{"id":"s2","kind":"stat","parent":"r","props":{"label":"Tokeny","value":1240000,"delta":"−38%","tone":"good"}}',
  '{"id":"c","kind":"chart","props":{"label":"Dziennie","variant":"bar","data":[{"label":"pon","value":402000},{"label":"wt","value":318000}]}}',
  '{"id":"l","kind":"chart","props":{"label":"Trend","variant":"line","data":[{"label":"t1","value":91000},{"label":"t2","value":68900}]}}',
].join('\n');

describe('parseAriUi', () => {
  it('reads one node per line in order', () => {
    const { nodes, skipped } = parseAriUi(SOURCE);
    expect(nodes.map((n) => n.id)).toEqual(['r', 's1', 's2', 'c', 'l']);
    expect(nodes[1].parent).toBe('r');
    expect(skipped).toBe(0);
  });

  it('skips broken, unknown, duplicate and orphaned lines but not an unfinished last line', () => {
    const { nodes, skipped } = parseAriUi([
      '{"id":"r","kind":"row"}',
      'nie json',
      '{"id":"x","kind":"script","props":{}}',
      '{"id":"r","kind":"row"}',
      '{"id":"s","kind":"stat","parent":"brak","props":{}}',
      '{"id":"s2","kind":"stat","parent":"s2b","props":{}}',
      '{"id":"r2","kind":"row","parent":"r"}',
      '{"id":"ok","kind":"stat","parent":"r","props":{"label":"A","value":1}}',
      '{"id":"pisany","kind":"cha',
    ].join('\n'));
    expect(nodes.map((n) => n.id)).toEqual(['r', 'ok']);
    expect(skipped).toBe(6);
  });

  it('only a row can be a parent', () => {
    const { nodes } = parseAriUi([
      '{"id":"s","kind":"stat","props":{}}',
      '{"id":"t","kind":"stat","parent":"s","props":{}}',
    ].join('\n'));
    expect(nodes.map((n) => n.id)).toEqual(['s']);
  });
});

describe('helpers', () => {
  it('rounds the axis up to a clean number', () => {
    expect(niceMax(402000)).toBe(500000);
    expect(niceMax(91000)).toBe(100000);
    expect(niceMax(7)).toBe(7);
    expect(niceMax(0)).toBe(1);
  });

  it('formats numbers the Polish way and compacts only large ones', () => {
    expect(formatValue(1240000)).toBe(`1,24${NBSP}mln`);
    expect(formatValue(68900)).toBe(`68,9${NBSP}tys.`);
    expect(formatValue(18)).toBe('18');
    expect(formatValue(1240000, false)).toBe(`1${NBSP}240${NBSP}000`);
    expect(formatValue('n/d')).toBe('n/d');
    expect(formatValue(Number.NaN)).toBe('');
  });

  it('keeps only points with a numeric value', () => {
    expect(chartPoints([{ label: 'a', value: 1 }, { label: 'b', value: 'x' }, { label: 'c', value: '3' }, null]))
      .toEqual([{ label: 'a', value: 1 }, { label: 'c', value: 3 }]);
    expect(chartPoints('nie lista')).toEqual([]);
  });
});

describe('renderAriUi', () => {
  it('draws a panel with a row of tiles and both chart kinds', () => {
    const el = document.createElement('div');
    renderAriUi(SOURCE, el);
    const panel = el.querySelector('.ari-ui') as HTMLElement;
    const row = panel.querySelector('.ari-ui-row') as HTMLElement;
    expect(row.querySelectorAll('.ari-ui-stat')).toHaveLength(2);
    expect(row.style.getPropertyValue('--ari-ui-cols')).toBe('2');
    expect(panel.querySelector('.ari-ui-stat-delta.is-good')?.textContent).toBe('−38%');
    expect(panel.querySelectorAll('.ari-ui-bar')).toHaveLength(2);
    expect(panel.querySelector('.ari-ui-line')).not.toBeNull();
    // jeden podpis wartosci na wykres: najwyzszy slupek i koniec linii
    expect([...panel.querySelectorAll('text.ari-ui-value')].map((t) => t.textContent)).toEqual([`402${NBSP}tys.`, `68,9${NBSP}tys.`]);
    expect(panel.querySelector('.ari-ui-skipped')).toBeNull();
  });

  it('shows the tooltip with the full value on hover', () => {
    const el = document.createElement('div');
    renderAriUi(SOURCE, el);
    const hit = el.querySelector('.ari-ui-hit') as Element;
    hit.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    const tip = el.querySelector('.ari-ui-tip') as HTMLElement;
    expect(tip.classList.contains('is-visible')).toBe(true);
    expect(tip.textContent).toBe(`pon: 402${NBSP}000`);
    hit.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip.classList.contains('is-visible')).toBe(false);
  });

  it('falls back to the raw source when nothing can be drawn', () => {
    const el = document.createElement('div');
    renderAriUi('to nie jest blok', el);
    expect(el.querySelector('.ari-ui')).toBeNull();
    expect(el.querySelector('pre')?.textContent).toBe('to nie jest blok');
  });

  it('reports skipped lines and draws an empty chart notice', () => {
    const el = document.createElement('div');
    renderAriUi('{"id":"c","kind":"chart","props":{"label":"X","data":[]}}\nzepsute\n{"id":"s","kind":"stat","props":{"label":"A","value":1}}', el);
    expect(el.querySelector('.ari-ui-empty')).not.toBeNull();
    expect(el.querySelector('.ari-ui-skipped')?.textContent).toBe('Pominięte linie bloku: 1');
  });
});
