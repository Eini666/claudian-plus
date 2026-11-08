import type { PlanRateLimits, PlanRateLimitWindow } from '@/core/types';

/**
 * Most do lokalnego panelu kont (`.claude/tools/accounts/accounts.mjs serve`).
 * Panel czyta limity KAZDEGO konta bez kosztu tokenowego i umie przelaczyc konto,
 * wiec wtyczka nie powiela tej logiki — tylko pyta. Panel jest opcjonalny:
 * gdy nie odpowiada, przelacznik sie wycofuje, a reszta paska dziala dalej.
 */

// Adres panelu przychodzi z ustawien (`accountsPanelUrl`); domyslny siedzi w defaultSettings.
const TIMEOUT_MS = 4000;

function endpoint(baseUrl: string, apiPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${apiPath}`;
}

interface PanelWindow {
  pct: number;
  resetsAt: string | null;
}

export interface PanelAccount {
  name: string;
  email: string;
  active: boolean;
  plan?: string;
  usage?: {
    session?: PanelWindow | null;
    weekly?: PanelWindow | null;
    error?: string;
  };
  /** Panel sam naprawil rozjazd tozsamosci (ostatnie 15 min) — plakietka o tym mowi. */
  repaired?: { at: number; from: string; to: string };
}

/** Lista kont z limitami; null gdy panel nie dziala albo odpowiada bzdurami. */
export async function fetchPanelAccounts(baseUrl: string): Promise<PanelAccount[] | null> {
  try {
    const res = await fetch(endpoint(baseUrl, '/api/accounts'), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as PanelAccount[]) : null;
  } catch {
    return null;
  }
}

/** Rzuca z komunikatem panelu, zeby Notice powiedzial, CO poszlo nie tak. */
export async function switchPanelAccount(baseUrl: string, name: string): Promise<void> {
  const res = await fetch(endpoint(baseUrl, '/api/switch'), {
    method: 'POST',
    // Bez naglowka Content-Type: application/json wymusiloby preflight CORS (OPTIONS),
    // ktorego panel nie obsluguje. Panel i tak parsuje tresc jako JSON.
    // zrodlo trafia do logu panelu — reczne przelaczenia wczesniej nie zostawialy sladu
    body: JSON.stringify({ name, source: 'claudian' }),
    // Przelaczenie potrafi najpierw odswiezyc token konta docelowego.
    signal: AbortSignal.timeout(TIMEOUT_MS * 3),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* zostaje kod HTTP */ }
    throw new Error(message);
  }
}

function toWindow(w: PanelWindow | null | undefined): PlanRateLimitWindow | undefined {
  if (!w || typeof w.pct !== 'number') return undefined;
  const resetsMs = w.resetsAt ? Date.parse(w.resetsAt) : Number.NaN;
  return {
    percentage: w.pct,
    resetsAt: Number.isFinite(resetsMs) ? Math.floor(resetsMs / 1000) : null,
  };
}

/**
 * Limity konta z panelu w formacie paska. Panel podaje procenty i daty ISO,
 * pasek chce procentow i unixa w sekundach. Stempel konta — patrz `forCurrentAccount`.
 */
export function panelUsageToPlanLimits(
  account: PanelAccount,
  accountId: string | null,
): PlanRateLimits | null {
  const fiveHour = toWindow(account.usage?.session);
  const sevenDay = toWindow(account.usage?.weekly);
  if (!fiveHour && !sevenDay) return null;
  return {
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

/** „jan@example.com” → „jan”. Plakietka ma byc krotka. */
export function accountShortLabel(email: string | null | undefined): string {
  if (!email) return '?';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/** „5h 51% · 7d 17%” albo powod, dla ktorego liczb nie ma. */
export function describePanelUsage(account: PanelAccount): string {
  const five = account.usage?.session;
  const week = account.usage?.weekly;
  if (!five && !week) return account.usage?.error ?? 'brak danych';
  const parts: string[] = [];
  if (five) parts.push(`5h ${five.pct}%`);
  if (week) parts.push(`7d ${week.pct}%`);
  return parts.join(' · ');
}

/**
 * Cache promptu jest PER KONTO i siedzi po stronie serwera. Po przelaczeniu nowe
 * konto nie ma w nim nic, wiec caly kontekst rozmowy leci do zapisu po 1,25×
 * zamiast odczytu po 0,1× — czyli 12,5× drozej za to samo.
 * Zmierzone 11.09: zapis 462 585 tok. zjadl 40% okna 5-godzinnego.
 *
 * Menu pokazuje to PRZED klikiem, bo inaczej rachunek jest niewidoczny do czasu,
 * az zniknie polowa limitu konta, na ktore uciekasz.
 */
const CICHO_PONIZEJ = 100_000;   // swieza rozmowa — nie ma o czym ostrzegac
const OSTRZEZ_POWYZEJ = 400_000; // tu przelaczenie zaczyna bolec bardziej niz pomaga

export function describeSwitchCost(contextTokens: number): string | null {
  if (!Number.isFinite(contextTokens) || contextTokens < CICHO_PONIZEJ) return null;
  const skrot = contextTokens >= 1000 ? `${Math.round(contextTokens / 1000)}k` : String(contextTokens);
  return contextTokens >= OSTRZEZ_POWYZEJ
    ? `⚠ zapis ${skrot} — rozważ nową rozmowę`
    : `zapis ${skrot}`;
}
