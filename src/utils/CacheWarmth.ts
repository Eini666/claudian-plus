/**
 * Czy cache promptu tej rozmowy jeszcze zyje — i na KTORYM koncie.
 *
 * Cache jest per konto i zyje godzine od ostatniego zapytania (Claude Code pisze go
 * jako `ephemeral_1h`). Dopoki zyje, tura czyta kontekst po 0,1× ceny; po przelaczeniu
 * konta albo po godzinie przerwy caly kontekst idzie do zapisu po 1,25×. Po godzinie
 * konto nie ma juz znaczenia — kazde zaplaci tyle samo.
 */

export const CACHE_TTL_MS = 60 * 60_000;

// Zmierzone 11.09 (Pro, Opus 5): zapis 462 585 tok. zjadl 40% okna 5-godzinnego.
// ponytail: jeden punkt kalibracji; korekta z pomiaru przed/po, gdy szacunek zacznie klamac
const ZAPIS_NA_PROCENT = 462_585 / 40;
const ODCZYT_DO_ZAPISU = 0.1 / 1.25;

/** Kiedy i na jakim koncie poszla ostatnia tura rozmowy. */
export interface TurnStamp {
  at: number;
  /** null = nie wiemy (rozmowa wczytana z dysku, a nie prowadzona w tej karcie). */
  accountId: string | null;
  email: string | null;
}

/** Konto ostatniej tury per rozmowa — trzymane w ustawieniach, bo zapis rozmowy go nie ma. */
export type TurnStamps = Record<string, TurnStamp>;

// Stemple starsze niz doba nic nie mowia — cache i tak dawno wygasl.
const KEEP_MS = 24 * 60 * 60_000;

/**
 * Nowy zestaw stempli albo null, gdy nie ma czego zapisywac. Zapis tylko przy ZMIANIE konta
 * rozmowy (albo pierwszej turze) — czas i tak przychodzi z `lastActivityAt` rozmowy,
 * wiec nie piszemy ustawien przy kazdej turze.
 */
export function withTurn(
  stamps: TurnStamps | undefined,
  conversationId: string | null,
  stamp: TurnStamp,
): TurnStamps | null {
  if (!conversationId || !stamp.accountId) return null;
  if (stamps?.[conversationId]?.accountId === stamp.accountId) return null;
  const next: TurnStamps = {};
  for (const [id, s] of Object.entries(stamps ?? {})) {
    if (stamp.at - s.at < KEEP_MS) next[id] = s;
  }
  next[conversationId] = stamp;
  return next;
}

/** Stempel po wczytaniu rozmowy: czas z jej zapisu, konto ze stempli, jesli je znamy. */
export function recallTurn(
  stamps: TurnStamps | undefined,
  conversationId: string,
  lastActivityAt: number,
): TurnStamp {
  const known = stamps?.[conversationId];
  return known
    ? { ...known, at: Math.max(known.at, lastActivityAt) }
    : { at: lastActivityAt, accountId: null, email: null };
}

export type CacheWarmthTone = 'warm' | 'mismatch' | 'unknown' | 'cold';

export interface CacheWarmth {
  tone: CacheWarmthTone;
  label: string;
  tooltip: string;
}

function shortName(email: string | null): string {
  if (!email) return '?';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function pct(value: number): string {
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

function clock(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`;
}

export function describeCacheWarmth(
  stamp: TurnStamp | null,
  contextTokens: number,
  currentAccountId: string | null,
  currentEmail: string | null,
  now = Date.now(),
): CacheWarmth | null {
  if (!stamp || !Number.isFinite(contextTokens) || contextTokens <= 0) return null;

  const zapis = contextTokens / ZAPIS_NA_PROCENT;
  const kosztZapisu = `zapis ${tokens(contextTokens)} ≈ ${pct(zapis)} sesji`;
  const kosztOdczytu = `odczyt ${tokens(contextTokens)} ≈ ${pct(zapis * ODCZYT_DO_ZAPISU)} sesji`;
  const left = stamp.at + CACHE_TTL_MS - now;

  if (left <= 0) {
    return {
      tone: 'cold',
      label: 'zimna',
      tooltip: `Cache wygasł (ostatnia tura ${clock(stamp.at, now)})\n`
        + `Następna tura na każdym koncie: ${kosztZapisu}`,
    };
  }

  const min = Math.ceil(left / 60_000);
  const warmOn = shortName(stamp.email);
  const label = `${warmOn} · ${min}m`;

  if (!stamp.accountId) {
    return {
      tone: 'unknown',
      label,
      tooltip: `Cache ciepły jeszcze ${min} min, ale nie wiem na którym koncie\n`
        + '(rozmowa wczytana z dysku — konto zapisze się przy następnej turze)\n'
        + `Ten sam: ${kosztOdczytu} · inne: ${kosztZapisu}`,
    };
  }

  if (currentAccountId && stamp.accountId !== currentAccountId) {
    return {
      tone: 'mismatch',
      label,
      tooltip: `Cache ciepły na ${warmOn} jeszcze ${min} min — aktywne jest ${shortName(currentEmail)}\n`
        + `Następna tura: ${kosztZapisu}\n`
        + `Powrót na ${warmOn}: ${kosztOdczytu}`,
    };
  }

  return {
    tone: 'warm',
    label,
    tooltip: `Cache ciepły na ${warmOn} jeszcze ${min} min\n`
      + `Następna tura: ${kosztOdczytu}\n`
      + `Po przełączeniu konta: ${kosztZapisu}`,
  };
}
