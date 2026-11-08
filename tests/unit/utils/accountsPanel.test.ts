import {
  accountShortLabel,
  describePanelUsage,
  describeSwitchCost,
  fetchPanelAccounts,
  fetchPanelHealth,
  type PanelAccount,
  panelUsageToPlanLimits,
  stopPanel,
  switchPanelAccount,
} from '@/utils/accountsPanel';

const PANEL = 'http://127.0.0.1:7788';

const account = (usage: PanelAccount['usage']): PanelAccount => ({
  name: 'jan',
  email: 'jan@example.com',
  active: true,
  usage,
});

describe('accountsPanel', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('panelUsageToPlanLimits', () => {
    it('przelicza procenty i daty ISO na format paska ze stemplem konta', () => {
      const limits = panelUsageToPlanLimits(account({
        session: { pct: 51, resetsAt: '2026-09-11T16:20:00.597558+00:00' },
        weekly: { pct: 17, resetsAt: '2026-09-17T06:00:00+00:00' },
      }), '00000000-0000-4000-8000-000000000001');

      expect(limits).toEqual({
        fiveHour: { percentage: 51, resetsAt: Math.floor(Date.parse('2026-09-11T16:20:00.597Z') / 1000) },
        sevenDay: { percentage: 17, resetsAt: Math.floor(Date.parse('2026-09-17T06:00:00Z') / 1000) },
        accountId: '00000000-0000-4000-8000-000000000001',
      });
    });

    it('zostawia null jako czas resetu, gdy okno sie nie zaczelo', () => {
      const limits = panelUsageToPlanLimits(account({ session: { pct: 0, resetsAt: null } }), null);
      expect(limits).toEqual({ fiveHour: { percentage: 0, resetsAt: null } });
    });

    it('zwraca null, gdy panel nie ma liczb (blad odczytu)', () => {
      expect(panelUsageToPlanLimits(account({ error: 'limit odczytów' }), 'x')).toBeNull();
    });
  });

  describe('accountShortLabel / describePanelUsage', () => {
    it('skraca adres do czesci przed malpa', () => {
      expect(accountShortLabel('anna@example.com')).toBe('anna');
      expect(accountShortLabel(null)).toBe('?');
    });

    it('opisuje limity albo powod ich braku', () => {
      expect(describePanelUsage(account({
        session: { pct: 3, resetsAt: null },
        weekly: { pct: 61, resetsAt: null },
      }))).toBe('5h 3% · 7d 61%');
      expect(describePanelUsage(account({ error: 'token wygasł' }))).toBe('token wygasł');
    });
  });

  describe('HTTP', () => {
    it('fetchPanelAccounts zwraca null, gdy panel nie odpowiada', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
      await expect(fetchPanelAccounts(PANEL)).resolves.toBeNull();
    });

    it('fetchPanelAccounts odrzuca odpowiedz, ktora nie jest lista', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'x' }) }) as any;
      await expect(fetchPanelAccounts(PANEL)).resolves.toBeNull();
    });

    it('fetchPanelAccounts pyta pod adres z ustawien, bez podwojnego ukosnika', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
      global.fetch = fetchMock as any;

      await expect(fetchPanelAccounts('http://192.168.1.5:9000/')).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.5:9000/api/accounts', expect.anything());
    });

    it('switchPanelAccount wysyla nazwe konta i przekazuje blad panelu', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'nie znam konta "zz"' }) });
      global.fetch = fetchMock as any;

      await expect(switchPanelAccount(PANEL, 'zz')).rejects.toThrow('nie znam konta "zz"');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:7788/api/switch',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'zz', source: 'claudian' }) }),
      );
    });

    it('fetchPanelHealth: nasz JSON → obiekt, 404 i inny JSON → obcy, blad sieci → null', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ app: 'claudian-plus-accounts', version: 1 }) }) as any;
      await expect(fetchPanelHealth(PANEL)).resolves.toEqual({ app: 'claudian-plus-accounts', version: 1 });

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }) as any;
      await expect(fetchPanelHealth(PANEL)).resolves.toBe('obcy');

      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ name: 'a' }] }) as any;
      await expect(fetchPanelHealth(PANEL)).resolves.toBe('obcy');

      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
      await expect(fetchPanelHealth(PANEL)).resolves.toBeNull();
    });

    it('stopPanel wysyla POST /api/shutdown bez Content-Type', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as any;

      await expect(stopPanel(PANEL)).resolves.toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:7788/api/shutdown');
      expect(init.method).toBe('POST');
      expect(init.headers).toBeUndefined();
    });
  });
});

describe('describeSwitchCost', () => {
  it('milczy przy swiezej rozmowie — nie ma o czym ostrzegac', () => {
    expect(describeSwitchCost(0)).toBeNull();
    expect(describeSwitchCost(40_000)).toBeNull();
    expect(describeSwitchCost(99_999)).toBeNull();
  });

  it('podaje sam rozmiar zapisu w srodkowym zakresie', () => {
    expect(describeSwitchCost(100_000)).toBe('zapis 100k');
    expect(describeSwitchCost(250_000)).toBe('zapis 250k');
    expect(describeSwitchCost(399_000)).toBe('zapis 399k');
  });

  it('powyzej progu ostrzega i podaje ALTERNATYWE, nie samą liczbę', () => {
    expect(describeSwitchCost(400_000)).toBe('⚠ zapis 400k — rozważ nową rozmowę');
    expect(describeSwitchCost(776_274)).toBe('⚠ zapis 776k — rozważ nową rozmowę');
  });

  it('smieciowe wejscie nie wywala menu', () => {
    expect(describeSwitchCost(Number.NaN)).toBeNull();
    expect(describeSwitchCost(-5)).toBeNull();
    expect(describeSwitchCost(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
