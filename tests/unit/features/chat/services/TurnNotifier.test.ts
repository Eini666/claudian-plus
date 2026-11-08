import {
  decide,
  extractErrorMessage,
  firstLine,
  notifyTurn,
  setAssistantNameSource,
  subscribeTurn,
  TurnNotifier,
  type TurnSignal,
  type WindowAdapter,
} from '@/features/chat/services/TurnNotifier';

function fakeAdapter(initiallyFocused = false) {
  let focused = initiallyFocused;
  let listener: ((f: boolean) => void) | null = null;
  const adapter: WindowAdapter & { overlays: unknown[]; flashes: boolean[]; toasts: string[][] } = {
    overlays: [],
    flashes: [],
    toasts: [],
    isFocused: () => focused,
    setOverlay: (c) => { adapter.overlays.push(c); },
    flash: (on) => { adapter.flashes.push(on); },
    toast: (t, b) => { adapter.toasts.push([t, b]); },
    onFocusChange: (l) => { listener = l; return () => { listener = null; }; },
  };
  const setFocus = (f: boolean) => { focused = f; listener?.(f); };
  return { adapter, setFocus };
}

describe('TurnNotifier module', () => {
  describe('decide', () => {
    it('przy aktywnym oknie nic nie pokazuje', () => {
      for (const signal of [
        { kind: 'working' as const },
        { kind: 'finished' as const, text: 'Gotowe' },
        { kind: 'error' as const, message: 'x' },
        { kind: 'waiting' as const },
        { kind: 'cancelled' as const },
      ]) {
        expect(decide(signal, true)).toEqual({ overlay: null, flash: false, toast: null });
      }
    });

    it('w tle: pracuje pomarańczowo bez dymka, koniec zielono z dymkiem, błąd czerwono', () => {
      expect(decide({ kind: 'working' }, false)).toEqual({ overlay: 'orange', flash: false, toast: null });
      expect(decide({ kind: 'finished', text: '## **Wypchnięte**\nreszta' }, false)).toEqual({
        overlay: 'green', flash: true, toast: { title: 'Claude: gotowe, sprawdź wynik', body: 'Wypchnięte' },
      });
      expect(decide({ kind: 'error', message: 'HTTP 500' }, false)).toEqual({
        overlay: 'red', flash: true, toast: { title: 'Błąd', body: 'HTTP 500' },
      });
      expect(decide({ kind: 'waiting' }, false).overlay).toBe('green');
      expect(decide({ kind: 'waiting' }, false).toast).toEqual({
        title: 'Claude czeka na Twoją decyzję', body: 'Pytanie albo prośba o zgodę w Claudianie',
      });
    });

    describe('nazwa asystenta z ustawien', () => {
      afterEach(() => setAssistantNameSource(() => undefined));

      it('ustawiona nazwa trafia do obu dymkow', () => {
        setAssistantNameSource(() => 'Ari');
        expect(decide({ kind: 'finished', text: 'ok' }, false).toast?.title).toBe('Ari: gotowe, sprawdź wynik');
        expect(decide({ kind: 'waiting' }, false).toast?.title).toBe('Ari czeka na Twoją decyzję');
      });

      it('zmiana w ustawieniach dziala od nastepnego sygnalu, bez restartu', () => {
        let name = 'Ari';
        setAssistantNameSource(() => name);
        const { adapter } = fakeAdapter(false);
        const notifier = new TurnNotifier(adapter);
        notifier.signal({ kind: 'finished', text: 'a' });
        name = 'Jarvis';
        notifier.signal({ kind: 'finished', text: 'b' });
        expect(adapter.toasts.map(([title]) => title)).toEqual([
          'Ari: gotowe, sprawdź wynik',
          'Jarvis: gotowe, sprawdź wynik',
        ]);
      });

      it('pusta albo z samych spacji nazwa → Claude, nigdy pusty napis', () => {
        for (const empty of ['', '   ', undefined, null]) {
          setAssistantNameSource(() => empty);
          expect(decide({ kind: 'finished', text: 'ok' }, false).toast?.title).toBe('Claude: gotowe, sprawdź wynik');
        }
      });
    });
  });

  it('firstLine skraca długą linię', () => {
    expect(firstLine('a'.repeat(200)).length).toBe(120);
    expect(firstLine('\n\n  - punkt  \n')).toBe('punkt');
  });

  it('extractErrorMessage bierze ostatni błąd albo zapasowy tekst', () => {
    expect(extractErrorMessage('tekst\n\n**Error:** pierwszy\n\n**Error:** drugi')).toBe('drugi');
    expect(extractErrorMessage('bez błędu')).toBe('Sprawdź rozmowę');
  });

  describe('TurnNotifier', () => {
    it('powrót do okna czyści kropkę i miganie', () => {
      const { adapter, setFocus } = fakeAdapter(false);
      const notifier = new TurnNotifier(adapter);

      notifier.signal({ kind: 'finished', text: 'Gotowe' });
      expect(adapter.overlays.at(-1)).toBe('green');
      expect(adapter.toasts).toEqual([['Claude: gotowe, sprawdź wynik', 'Gotowe']]);

      setFocus(true);
      expect(adapter.overlays.at(-1)).toBeNull();
      expect(adapter.flashes.at(-1)).toBe(false);
    });

    it('wyjście z okna w trakcie pracy zapala pomarańczową kropkę, po końcu już nie', () => {
      const { adapter, setFocus } = fakeAdapter(true);
      const notifier = new TurnNotifier(adapter);

      notifier.signal({ kind: 'working' });
      expect(adapter.overlays.at(-1)).toBeNull();

      setFocus(false);
      expect(adapter.overlays.at(-1)).toBe('orange');

      setFocus(true);
      notifier.signal({ kind: 'finished', text: 'ok' });
      setFocus(false);
      expect(adapter.overlays.at(-1)).toBeNull();
    });

    it('dispose odpina nasłuch fokusu', () => {
      const { adapter, setFocus } = fakeAdapter(false);
      const notifier = new TurnNotifier(adapter);
      notifier.signal({ kind: 'working' });
      notifier.dispose();
      const before = adapter.overlays.length;

      setFocus(true);
      expect(adapter.overlays.length).toBe(before);
    });
  });
});

describe('przerwanie i powrot do spoczynku', () => {
  it('anulowanie milczy nawet w tle — użytkownik sam przerwal, wie o tym', () => {
    expect(decide({ kind: 'cancelled' }, false)).toEqual({ overlay: null, flash: false, toast: null });
  });

  it('„skonczylam" gasnie po minucie i wraca do spoczynku', () => {
    jest.useFakeTimers();
    const seen: (TurnSignal | null)[] = [];
    const off = subscribeTurn(signal => { seen.push(signal); });

    notifyTurn({ kind: 'finished', text: 'gotowe' });
    expect(seen[seen.length - 1]).toEqual({ kind: 'finished', text: 'gotowe' });

    jest.advanceTimersByTime(59_000);
    expect(seen[seen.length - 1]).toEqual({ kind: 'finished', text: 'gotowe' });

    jest.advanceTimersByTime(1_000);
    expect(seen[seen.length - 1]).toBeNull();

    off();
    jest.useRealTimers();
  });

  it('nowa tura uniewaznia zaplanowany powrot', () => {
    jest.useFakeTimers();
    const seen: (TurnSignal | null)[] = [];
    const off = subscribeTurn(signal => { seen.push(signal); });

    notifyTurn({ kind: 'finished', text: 'pierwsza' });
    jest.advanceTimersByTime(30_000);
    notifyTurn({ kind: 'working' });
    jest.advanceTimersByTime(40_000);

    // Gdyby stary zegar przezyl, „pracuje" zostaloby zdjete w polowie roboty.
    expect(seen[seen.length - 1]).toEqual({ kind: 'working' });

    off();
    jest.useRealTimers();
  });
});
