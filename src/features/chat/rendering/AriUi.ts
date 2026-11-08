// Bloki ```plus-ui (alias ```ari-ui): kafelki z liczbami, wykres slupkowy/liniowy i wiersze kolumn w odpowiedzi modelu.
// Wzor: Cindy `rich-answers` (cindy-ui), okrojony do minimum na probe (27.10.2026). Jedna linia = jeden wezel JSON,
// wiec w trakcie strumieniowania rysuje sie to, co juz doszlo; niedokonczona ostatnia linia czeka.
// Kolory wylacznie z motywu Obsidiana — model podaje uklad i dane, nigdy barwy.

export type AriUiKind = 'row' | 'stat' | 'chart';

export interface AriUiNode {
  id: string;
  kind: AriUiKind;
  parent?: string;
  props: Record<string, unknown>;
}

export interface ParsedAriUi {
  nodes: AriUiNode[];
  /** Pelne linie, ktorych nie da sie narysowac (zly JSON, nieznany rodzaj, brak rodzica). */
  skipped: number;
}

export interface ChartPoint {
  label: string;
  value: number;
}

const KINDS = new Set<AriUiKind>(['row', 'stat', 'chart']);
const MAX_NODES = 200;
const ID = /^[\w-]{1,80}$/;

/** Zla ostatnia linia nie liczy sie jako pominieta: w trakcie strumieniowania jest jeszcze pisana. */
export function parseAriUi(source: string): ParsedAriUi {
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const nodes: AriUiNode[] = [];
  const ids = new Map<string, AriUiKind>();
  let skipped = 0;
  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      if (!last) skipped++;
      return;
    }
    const node = toNode(raw);
    const parentKind = node?.parent === undefined ? undefined : ids.get(node.parent);
    if (!node || ids.has(node.id) || nodes.length >= MAX_NODES
      || (node.parent !== undefined && parentKind !== 'row') || (node.kind === 'row' && node.parent !== undefined)) {
      skipped++;
      return;
    }
    ids.set(node.id, node.kind);
    nodes.push(node);
  });
  return { nodes, skipped };
}

function toNode(raw: unknown): AriUiNode | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id) || !KINDS.has(o.kind as AriUiKind)) return null;
  if (o.parent !== undefined && typeof o.parent !== 'string') return null;
  const props = typeof o.props === 'object' && o.props !== null ? o.props as Record<string, unknown> : {};
  return { id: o.id, kind: o.kind as AriUiKind, parent: o.parent, props };
}

export function chartPoints(data: unknown): ChartPoint[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((d) => {
    const o = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
    const value = typeof o.value === 'number' ? o.value : Number(o.value);
    return Number.isFinite(value) ? [{ label: String(o.label ?? ''), value }] : [];
  });
}

/** Okragly sufit osi: 402 000 → 500 000, 91 000 → 100 000. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
}

const COMPACT = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 2 });
const FULL = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

export function formatValue(value: unknown, compact = true): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) >= 10_000 && compact ? COMPACT.format(value) : FULL.format(value);
  }
  return typeof value === 'string' ? value : '';
}

// ---------- rysowanie ----------

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const el = activeDocument.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent.appendChild(el);
  return el;
}

function div(cls: string, parent: HTMLElement, text?: string): HTMLDivElement {
  return parent.createDiv(text === undefined ? { cls } : { cls, text });
}

function renderStat(props: Record<string, unknown>, parent: HTMLElement): void {
  const tile = div('ari-ui-stat', parent);
  div('ari-ui-stat-label', tile, String(props.label ?? ''));
  const prefix = typeof props.prefix === 'string' ? props.prefix : '';
  const suffix = typeof props.suffix === 'string' ? props.suffix : '';
  div('ari-ui-stat-value', tile, `${prefix}${formatValue(props.value)}${suffix}`);
  if (typeof props.delta === 'string' && props.delta) {
    const tone = props.tone === 'good' || props.tone === 'bad' ? ` is-${props.tone}` : '';
    div(`ari-ui-stat-delta${tone}`, tile, props.delta);
  }
}

function renderChart(props: Record<string, unknown>, parent: HTMLElement, tip: HTMLDivElement): void {
  const data = chartPoints(props.data);
  const box = div('ari-ui-chart', parent);
  const title = String(props.label ?? '');
  if (title) div('ari-ui-chart-label', box, title);
  if (data.length === 0) {
    div('ari-ui-empty', box, 'Brak danych do wykresu.');
    return;
  }
  const suffix = typeof props.suffix === 'string' ? props.suffix : '';
  const W = 600, H = 200, L = 52, R = 14, T = 20, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title }, box);
  const values = data.map((d) => d.value);
  const max = niceMax(Math.max(...values, 0));
  const y = (v: number): number => T + ih - Math.max(0, v) / max * ih;
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i ? 'ari-ui-grid' : 'ari-ui-base' }, svg);
    svgEl('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = formatValue(v);
  }
  const band = iw / data.length;
  const showTip = (event: MouseEvent, point: ChartPoint): void => {
    const host = tip.parentElement?.getBoundingClientRect();
    tip.textContent = `${point.label}: ${formatValue(point.value, false)}${suffix}`;
    tip.classList.add('is-visible');
    tip.style.setProperty('left', `${event.clientX - (host?.left ?? 0) + 12}px`);
    tip.style.setProperty('top', `${event.clientY - (host?.top ?? 0) - 30}px`);
  };
  const hideTip = (): void => { tip.classList.remove('is-visible'); };
  const label = (x: number, text: string): void => {
    svgEl('text', { x, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = text;
  };
  // Podpis wartosci tylko przy jednym punkcie (najwyzszy slupek / koniec linii), reszta w dymku.
  const valueLabel = (x: number, yy: number, v: number): void => {
    svgEl('text', { x, y: yy, 'text-anchor': 'middle', class: 'ari-ui-value' }, svg).textContent = formatValue(v) + suffix;
  };

  if (props.variant === 'line') {
    const pts = data.map((d, i) => [L + band * i + band / 2, y(d.value)] as const);
    const line = pts.map(([px, py]) => `${px},${py}`).join(' L');
    svgEl('path', { class: 'ari-ui-area', d: `M${pts[0][0]},${T + ih} L${line} L${pts[pts.length - 1][0]},${T + ih} Z` }, svg);
    svgEl('path', { class: 'ari-ui-line', d: `M${line}` }, svg);
    const cross = svgEl('line', { class: 'ari-ui-cross', y1: T, y2: T + ih, x1: 0, x2: 0, visibility: 'hidden' }, svg);
    pts.forEach(([px, py], i) => {
      label(px, data[i].label);
      if (i === pts.length - 1) {
        svgEl('circle', { class: 'ari-ui-dot', cx: px, cy: py, r: 5 }, svg);
        valueLabel(px, py - 12, data[i].value);
      }
      const hit = svgEl('rect', { class: 'ari-ui-hit', x: px - band / 2, y: T, width: band, height: ih }, svg);
      hit.addEventListener('mousemove', (e) => {
        cross.setAttribute('x1', String(px));
        cross.setAttribute('x2', String(px));
        cross.setAttribute('visibility', 'visible');
        showTip(e, data[i]);
      });
      hit.addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
    });
    return;
  }

  const bw = Math.min(24, band * 0.6);
  const top = values.indexOf(Math.max(...values));
  data.forEach((d, i) => {
    const cx = L + band * i + band / 2, x = cx - bw / 2, yt = y(d.value);
    const r = Math.min(4, T + ih - yt);
    svgEl('path', {
      class: 'ari-ui-bar',
      d: `M${x},${T + ih} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${T + ih} Z`,
    }, svg);
    label(cx, d.label);
    if (i === top) valueLabel(cx, yt - 6, d.value);
    const hit = svgEl('rect', { class: 'ari-ui-hit', x: L + band * i, y: T, width: band, height: ih }, svg);
    hit.addEventListener('mousemove', (e) => showTip(e, d));
    hit.addEventListener('mouseleave', hideTip);
  });
}

/** Procesor bloku `plus-ui` i aliasu `ari-ui` (czat i notatki). Bez zadnego wezla zostawia zrodlo jako kod — nic nie ginie. */
export function renderAriUi(source: string, el: HTMLElement): void {
  const { nodes, skipped } = parseAriUi(source);
  if (nodes.length === 0) {
    el.createEl('pre', { text: source });
    return;
  }
  const panel = div('ari-ui', el);
  const tip = div('ari-ui-tip', panel);
  const rows = new Map<string, HTMLDivElement>();
  for (const node of nodes) {
    const parent = node.parent ? rows.get(node.parent) ?? panel : panel;
    if (node.kind === 'row') {
      rows.set(node.id, div('ari-ui-row', parent));
    } else if (node.kind === 'stat') {
      renderStat(node.props, parent);
    } else {
      renderChart(node.props, parent, tip);
    }
  }
  rows.forEach((row) => row.style.setProperty('--ari-ui-cols', String(Math.max(1, row.childElementCount))));
  if (skipped > 0) div('ari-ui-skipped', panel, `Pominięte linie bloku: ${skipped}`);
}
