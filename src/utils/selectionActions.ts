/**
 * Czyste funkcje menu „zaznaczony tekst w rozmowie → cytat / notatka / zadanie”.
 * Bez Obsidiana i bez dysku, zeby dalo sie je sprawdzic testem.
 */

import { resolveAssistantName } from '../core/types/settings';

const pad = (n: number): string => String(n).padStart(2, '0');

/** „11.09.2026 17:05” — format dat w notatkach użytkownika. */
export function formatStamp(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Kazda linia jako cytat markdownu + pusta linia na odpowiedz pod spodem. */
/** Skad pochodzi cytowany fragment — odczytane z elementu wiadomosci. */
export interface QuoteSource {
  readonly id?: string;
  readonly role?: string;
}

/**
 * Etykiety pisane z perspektywy pola wpisywania: cytuje zawsze uzytkownik,
 * wiec „Ty" to on, a nazwa asystenta z ustawien to druga strona.
 */
const AUTORZY: Record<string, string> = { user: 'Ty' };

function author(role: string | undefined, assistantName: unknown): string | undefined {
  if (role === 'assistant') return resolveAssistantName(assistantName);
  return role ? AUTORZY[role] : undefined;
}

/** Ile znakow brac, gdy identyfikator nie ma segmentow. */
export const QUOTE_ID_CHARS = 8;

/**
 * Rozrozniajaca czesc identyfikatora wiadomosci.
 *
 * Identyfikatory Claudiana wygladaja tak: `msg-1789050511497-0dr2kxe`, wiec POCZATEK
 * jest wspolny dla wszystkich — zmierzone na 235 prawdziwych: pierwsze 8 znakow daje
 * 2 unikalne wartosci, a ogon po ostatnim mysliku 235 z 235. Bez segmentow (np. goly
 * skrot) bierzemy poczatek, bo nie ma czego wycinac.
 */
export function quoteAnchor(id?: string): string {
  const czysty = id?.trim() ?? '';
  if (!czysty) return '';
  const czesci = czysty.split('-').filter(Boolean);
  return czesci.length > 1 ? czesci[czesci.length - 1] : czysty.slice(0, QUOTE_ID_CHARS);
}

/**
 * Naglowek cytatu, np. `> [Ari · msg a1b2c3d4]`. `null`, gdy nie ma czego podac —
 * wtedy cytat zostaje goly, tak jak przed 15.09.
 */
export function quoteHeader(source?: QuoteSource, assistantName?: string): string | null {
  const autor = author(source?.role, assistantName);
  const skrot = quoteAnchor(source?.id);
  const czesci = [autor, skrot ? `msg ${skrot}` : ''].filter(Boolean);
  return czesci.length ? `> [${czesci.join(' · ')}]` : null;
}

export function formatQuote(text: string, source?: QuoteSource, assistantName?: string): string {
  const body = text.trim().split(/\r?\n/).map(line => (line.trim() ? `> ${line}` : '>')).join('\n');
  const naglowek = quoteHeader(source, assistantName);
  return naglowek ? `${naglowek}\n${body}\n\n` : `${body}\n\n`;
}

/**
 * Pierwsza niepusta linia bez ozdobnikow markdownu, przycieta do `max` znakow
 * na granicy slowa — tytul zadania albo notatki.
 */
export function titleFromSelection(text: string, max = 60): string {
  const firstLine = text.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
  const clean = firstLine
    .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
  if (clean.length <= max) return clean || 'Fragment rozmowy';
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

const POLISH: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** kebab-case ASCII — slug zadania musi byc bezpieczna nazwa pliku i linkiem w to_do.md. */
export function slugify(text: string, max = 50): string {
  const ascii = text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, ch => POLISH[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '') || 'fragment-rozmowy';
}

/** Nazwa pliku notatki bez znakow, ktorych Windows i Obsidian nie przyjma. */
export function safeNoteName(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/…$/, '').trim() || 'Fragment rozmowy';
}

/** Wpis doklejany na koniec Brudnopisu — oddzielony, z data, zeby dalo sie go znalezc. */
export function scratchpadEntry(text: string, date: Date): string {
  return `\n\n---\n*Z rozmowy · ${formatStamp(date)}*\n\n${text.trim()}\n`;
}

/** Tresc osobnej notatki w `Zasoby/`. */
export function resourceNote(text: string, title: string, date: Date): string {
  return `# ${title}\n\n*Z rozmowy w Claudianie · ${formatStamp(date)}*\n\n${text.trim()}\n`;
}
