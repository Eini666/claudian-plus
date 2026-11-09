import type { PlanRateLimits, PlanRateLimitWindow } from '../../../core/types';

/**
 * Czy tura stoi na limicie planu i kiedy ruszy (unix, sekundy). Dwa sygnaly z CLI
 * pod watchdogiem (CLAUDE_CODE_RETRY_WATCHDOG): `rate_limit_event` ze statusem
 * `rejected` i `api_retry` z kodem 429. Ktory realnie przychodzi — nie zmierzone
 * (25.10), stad oba; wygrywa reset okna planu, bo to prawdziwa godzina.
 */
export function resolveLimitWait(
  limits: PlanRateLimits | null,
  retryAt: number | null,
  nowSeconds: number,
): { readonly resumesAt: number | null } | null {
  const exhausted = limits?.status === 'rejected' ? pickExhaustedWindow(limits) : null;
  // Zapamietany `rejected` sprzed resetu nie moze zapalic karty na starcie nowej tury.
  if (exhausted && (exhausted.resetsAt === null || exhausted.resetsAt > nowSeconds)) {
    return { resumesAt: exhausted.resetsAt };
  }
  if (retryAt !== null && retryAt > nowSeconds) {
    return { resumesAt: retryAt };
  }
  return null;
}

function pickExhaustedWindow(limits: PlanRateLimits): PlanRateLimitWindow | null {
  const windows = [limits.fiveHour, limits.sevenDay]
    .filter((w): w is PlanRateLimitWindow => Boolean(w));
  // `percentage` 0-100 (ulamek z SDK przeliczony przy odbiorze).
  const full = windows.filter(w => w.percentage >= 100);
  // Wyczerpane oba okna: rusza dopiero po pozniejszym resecie.
  if (full.length > 0) {
    return full.reduce((latest, w) => ((w.resetsAt ?? 0) > (latest.resetsAt ?? 0) ? w : latest));
  }
  // CLI odmawia tuz ponizej 100% (09.11: 5h na ~99%). Blokuje najpelniejsze okno,
  // nie to z najpozniejszym resetem — inaczej karta pokazywala reset tygodniowy.
  if (windows.length === 0) return null;
  return windows.reduce((fullest, w) => (w.percentage > fullest.percentage ? w : fullest));
}

const FIVE_HOURS_S = 5 * 3600;
const RESET_MATCH_S = 120;

/**
 * Pasek na odmowe CLI (api_retry 429 z godzina ponowienia = reset okna + 1 s).
 * `rate_limit_event` `rejected` przy limicie nie przychodzi (zmierzone 25.10), a odczyt
 * panelu potrafi byc sprzed kilku minut — pasek stal na 83%, gdy CLI juz odmawialo (09.11).
 * Zwraca limity z zablokowanym oknem na 100% albo null, gdy pasek juz to pokazuje.
 */
export function markLimitReached(
  limits: PlanRateLimits | null,
  retryAt: number,
  nowSeconds: number,
): PlanRateLimits | null {
  const matches = (w: PlanRateLimitWindow | undefined): boolean =>
    Boolean(w?.resetsAt != null && Math.abs(w.resetsAt - retryAt) <= RESET_MATCH_S);
  const key: 'fiveHour' | 'sevenDay' = matches(limits?.fiveHour) ? 'fiveHour'
    : matches(limits?.sevenDay) ? 'sevenDay'
      : retryAt - nowSeconds <= FIVE_HOURS_S ? 'fiveHour' : 'sevenDay';
  const current = limits?.[key];
  if (limits?.status === 'rejected' && current?.percentage === 100 && matches(current)) return null;
  const resetsAt = matches(current) ? current!.resetsAt : retryAt;
  return { ...limits, status: 'rejected', [key]: { percentage: 100, resetsAt } };
}

/** „12:21”, a dla resetu w innym dniu „pon. 12:21”. */
export function formatResumeTime(resumesAt: number, now: Date = new Date()): string {
  const at = new Date(resumesAt * 1000);
  const time = at.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString('pl-PL', { weekday: 'short' })} ${time}`;
}
