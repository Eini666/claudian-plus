import type { PlanRateLimits } from '@/core/types';
import { formatResumeTime, markLimitReached, resolveLimitWait } from '@/features/chat/services/limitWait';

const NOW = 1_800_000_000;

describe('resolveLimitWait', () => {
  it('waits for the exhausted five-hour window', () => {
    const limits: PlanRateLimits = {
      status: 'rejected',
      fiveHour: { percentage: 100, resetsAt: NOW + 3600 },
      sevenDay: { percentage: 62, resetsAt: NOW + 86_400 },
    };
    expect(resolveLimitWait(limits, null, NOW)).toEqual({ resumesAt: NOW + 3600 });
  });

  it('waits for the later reset when both windows are exhausted', () => {
    const limits: PlanRateLimits = {
      status: 'rejected',
      fiveHour: { percentage: 100, resetsAt: NOW + 3600 },
      sevenDay: { percentage: 100, resetsAt: NOW + 86_400 },
    };
    expect(resolveLimitWait(limits, null, NOW)).toEqual({ resumesAt: NOW + 86_400 });
  });

  it('waits for the fullest window when the rejection comes just below 100%', () => {
    // 09.11: CLI odmowil przy 5h ~99%, karta pokazala reset tygodniowy (niedziela).
    const limits: PlanRateLimits = {
      status: 'rejected',
      fiveHour: { percentage: 99, resetsAt: NOW + 3600 },
      sevenDay: { percentage: 15, resetsAt: NOW + 6 * 86_400 },
    };
    expect(resolveLimitWait(limits, null, NOW)).toEqual({ resumesAt: NOW + 3600 });
  });

  it('ignores a remembered rejection whose window has already reset', () => {
    const limits: PlanRateLimits = { status: 'rejected', fiveHour: { percentage: 100, resetsAt: NOW - 60 } };
    expect(resolveLimitWait(limits, null, NOW)).toBeNull();
  });

  it('falls back to the API retry time when limits are not rejected', () => {
    const limits: PlanRateLimits = { status: 'allowed', fiveHour: { percentage: 40, resetsAt: NOW + 3600 } };
    expect(resolveLimitWait(limits, NOW + 300, NOW)).toEqual({ resumesAt: NOW + 300 });
    expect(resolveLimitWait(limits, NOW - 1, NOW)).toBeNull();
    expect(resolveLimitWait(null, null, NOW)).toBeNull();
  });
});

describe('formatResumeTime', () => {
  it('shows only the time for today and a weekday otherwise', () => {
    const now = new Date(2026, 9, 25, 9, 0);
    const today = new Date(2026, 9, 25, 12, 21).getTime() / 1000;
    const monday = new Date(2026, 9, 26, 12, 21).getTime() / 1000;
    expect(formatResumeTime(today, now)).toBe('12:21');
    expect(formatResumeTime(monday, now)).toMatch(/12:21$/);
    expect(formatResumeTime(monday, now)).not.toBe('12:21');
  });
});

describe('markLimitReached', () => {
  it('fills the five-hour window whose reset matches the retry time', () => {
    const limits: PlanRateLimits = {
      status: 'allowed_warning',
      fiveHour: { percentage: 83, resetsAt: NOW + 3600 },
      sevenDay: { percentage: 50, resetsAt: NOW + 3 * 86_400 },
    };
    expect(markLimitReached(limits, NOW + 3601, NOW)).toEqual({
      status: 'rejected',
      fiveHour: { percentage: 100, resetsAt: NOW + 3600 },
      sevenDay: { percentage: 50, resetsAt: NOW + 3 * 86_400 },
    });
  });

  it('fills the weekly window when the retry is days away', () => {
    const limits: PlanRateLimits = { fiveHour: { percentage: 40, resetsAt: NOW + 7200 } };
    expect(markLimitReached(limits, NOW + 2 * 86_400, NOW)).toEqual({
      status: 'rejected',
      fiveHour: { percentage: 40, resetsAt: NOW + 7200 },
      sevenDay: { percentage: 100, resetsAt: NOW + 2 * 86_400 },
    });
  });

  it('builds the window from the retry time when no limits are known yet', () => {
    expect(markLimitReached(null, NOW + 1800, NOW)).toEqual({
      status: 'rejected',
      fiveHour: { percentage: 100, resetsAt: NOW + 1800 },
    });
  });

  it('returns null when the bar already shows the rejection', () => {
    const limits: PlanRateLimits = {
      status: 'rejected',
      fiveHour: { percentage: 100, resetsAt: NOW + 3600 },
    };
    expect(markLimitReached(limits, NOW + 3601, NOW)).toBeNull();
  });
});
