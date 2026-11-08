import { CACHE_TTL_MS, describeCacheWarmth, recallTurn, type TurnStamp, withTurn } from '@/utils/CacheWarmth';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const now = new Date(2026, 8, 24, 20, 0).getTime();
const stamp = (minutesAgo: number, accountId: string | null = A): TurnStamp => ({
  at: now - minutesAgo * 60_000,
  accountId,
  email: accountId ? 'jkowalski@example.com' : null,
});

describe('describeCacheWarmth', () => {
  it('bez stempla albo bez kontekstu nic nie pokazuje', () => {
    expect(describeCacheWarmth(null, 200_000, A, null, now)).toBeNull();
    expect(describeCacheWarmth(stamp(5), 0, A, null, now)).toBeNull();
  });

  it('to samo konto w oknie TTL: cieplo, konto i minuty w etykiecie', () => {
    const w = describeCacheWarmth(stamp(22), 212_000, A, 'jkowalski@example.com', now);
    expect(w?.tone).toBe('warm');
    expect(w?.label).toBe('jkowalski · 38m');
    // 212k / (462 585 / 40) = 18,3% zapisu; odczyt to 8% tego = 1,5%
    expect(w?.tooltip).toContain('odczyt 212k ≈ 1% sesji');
    expect(w?.tooltip).toContain('zapis 212k ≈ 18% sesji');
  });

  it('aktywne inne konto niz to z cache: ostrzezenie z kosztem zapisu', () => {
    const w = describeCacheWarmth(stamp(22), 212_000, B, 'anowak@example.com', now);
    expect(w?.tone).toBe('mismatch');
    expect(w?.tooltip).toContain('aktywne jest anowak');
    expect(w?.tooltip).toContain('Następna tura: zapis 212k ≈ 18% sesji');
  });

  it('po godzinie zimna niezaleznie od konta', () => {
    const w = describeCacheWarmth({ ...stamp(0), at: now - CACHE_TTL_MS }, 480_000, B, null, now);
    expect(w?.tone).toBe('cold');
    expect(w?.label).toBe('zimna');
    expect(w?.tooltip).toContain('ostatnia tura 19:00'); // dzisiaj -> sama godzina, bez daty
  });

  it('rozmowa wczytana z dysku: cieplo, ale konto nieznane', () => {
    const w = describeCacheWarmth(stamp(10, null), 50_000, A, null, now);
    expect(w?.tone).toBe('unknown');
    expect(w?.label).toBe('? · 50m');
  });

  it('maly kontekst: odczyt ponizej procenta pisany jako <1%', () => {
    const w = describeCacheWarmth(stamp(1), 20_000, A, null, now);
    expect(w?.tooltip).toContain('odczyt 20k ≈ <1% sesji');
  });
});

describe('withTurn / recallTurn', () => {
  it('zapisuje tylko przy zmianie konta rozmowy', () => {
    const first = withTurn(undefined, 'r1', stamp(0, A));
    expect(first?.r1.accountId).toBe(A);
    expect(withTurn(first!, 'r1', stamp(0, A))).toBeNull(); // to samo konto — bez zapisu
    expect(withTurn(first!, 'r1', stamp(0, B))?.r1.accountId).toBe(B);
  });

  it('bez id rozmowy albo bez konta nic nie zapisuje', () => {
    expect(withTurn(undefined, null, stamp(0, A))).toBeNull();
    expect(withTurn(undefined, 'r1', stamp(0, null))).toBeNull();
  });

  it('wycina stemple starsze niz doba', () => {
    const old = { r0: { ...stamp(0, A), at: now - 25 * 60 * 60_000 } };
    expect(Object.keys(withTurn(old, 'r1', stamp(0, B))!)).toEqual(['r1']);
  });

  it('po wczytaniu: konto ze stempli, czas nowszy z dwoch', () => {
    const stamps = { r1: stamp(30, A) };
    const later = now - 5 * 60_000;
    expect(recallTurn(stamps, 'r1', later)).toMatchObject({ accountId: A, at: later });
    expect(recallTurn(stamps, 'r2', later)).toEqual({ at: later, accountId: null, email: null });
  });
});
