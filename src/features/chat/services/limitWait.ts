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
  const candidates = full.length > 0 ? full : windows;
  if (candidates.length === 0) return null;
  // Wyczerpane oba okna: rusza dopiero po pozniejszym resecie.
  return candidates.reduce((latest, w) => ((w.resetsAt ?? 0) > (latest.resetsAt ?? 0) ? w : latest));
}

/** „12:21”, a dla resetu w innym dniu „pon. 12:21”. */
export function formatResumeTime(resumesAt: number, now: Date = new Date()): string {
  const at = new Date(resumesAt * 1000);
  const time = at.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString('pl-PL', { weekday: 'short' })} ${time}`;
}
