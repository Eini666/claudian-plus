import { ARI_RESTING, type AriLook, lookForSignal } from '@/features/chat/services/AriAvatar';
import { AriWidgetController, type WidgetSurface } from '@/features/chat/services/AriWidget';
import { TURN_COLORS,type TurnSignal } from '@/features/chat/services/TurnNotifier';

const ALL: TurnSignal[] = [
  { kind: 'working' }, { kind: 'observing' }, { kind: 'thinking' }, { kind: 'processing' },
  { kind: 'speaking' }, { kind: 'finished', text: 'x' }, { kind: 'error', message: 'x' },
  { kind: 'waiting' }, { kind: 'cancelled' },
];

describe('AriAvatar', () => {
  it('mapuje sygnal tury na stan robota i kolor paska zadan', () => {
    expect(lookForSignal({ kind: 'working' })).toEqual({ state: 'working', color: TURN_COLORS.orange });
    expect(lookForSignal({ kind: 'finished', text: 'x' })).toEqual({ state: 'happy', color: TURN_COLORS.green });
    expect(lookForSignal({ kind: 'error', message: 'x' })).toEqual({ state: 'error', color: TURN_COLORS.red });
    expect(lookForSignal({ kind: 'waiting' }).state).toBe('listening');
    expect(lookForSignal({ kind: 'speaking' }).state).toBe('speaking');
  });

  // Przy 20 px twarzy nie widac — kolor jest jedynym nosnikiem (13.09). Pary, ktore
  // dziela stan robota albo wyglad w pasku, MUSZA miec rozne kolory obudowy.
  it('stany rozroznialne tylko kolorem nie dziela koloru', () => {
    const color = (s: TurnSignal | null) => lookForSignal(s).color;
    expect(color({ kind: 'processing' })).not.toBe(color({ kind: 'working' }));
    expect(color({ kind: 'waiting' })).not.toBe(color({ kind: 'finished', text: 'x' }));
    expect(color({ kind: 'waiting' })).not.toBe(color(null));
    expect(color({ kind: 'cancelled' })).not.toBe(color(null));
    expect(color({ kind: 'observing' })).not.toBe(color(null));
  });

  it('przerwana tura nie zostaje na „pracuje"', () => {
    const look = lookForSignal({ kind: 'cancelled' });
    expect(look.state).toBe('idle');
    expect(look.color).not.toBe(TURN_COLORS.orange);
    expect(look.rests).toBeFalsy();
  });

  it('tylko spoczynek moze zasnac', () => {
    expect(lookForSignal(null)).toBe(ARI_RESTING);
    expect(ARI_RESTING.rests).toBe(true);
    for (const signal of ALL) expect(lookForSignal(signal).rests).toBeFalsy();
  });
});

function fakeSurface() {
  const surface: WidgetSurface & { renders: AriLook[]; hides: number; destroys: number } = {
    renders: [],
    hides: 0,
    destroys: 0,
    render: (look) => { surface.renders.push(look); },
    hide: () => { surface.hides += 1; },
    destroy: () => { surface.destroys += 1; },
  };
  return surface;
}

describe('AriWidgetController', () => {
  it('wylaczony nie pokazuje sie nigdy, nawet gdy Obsidian w tle', () => {
    const surface = fakeSurface();
    const widget = new AriWidgetController(surface);
    widget.update({ kind: 'working' }, false);
    expect(surface.renders).toHaveLength(0);
  });

  it('wlaczony pokazuje sie tylko przy oknie w tle', () => {
    const surface = fakeSurface();
    const widget = new AriWidgetController(surface);
    widget.setEnabled(true);

    widget.update({ kind: 'working' }, true);
    expect(surface.renders).toHaveLength(0);

    widget.update({ kind: 'working' }, false);
    expect(surface.renders).toHaveLength(1);
  });

  it('powrot do Obsidiana chowa okno, i tylko raz', () => {
    const surface = fakeSurface();
    const widget = new AriWidgetController(surface);
    widget.setEnabled(true);
    widget.update({ kind: 'working' }, false);

    widget.update({ kind: 'working' }, true);
    widget.update({ kind: 'finished', text: 'gotowe' }, true);
    expect(surface.hides).toBe(1);
  });

  it('wylaczenie przelacznika chowa otwarte okno', () => {
    const surface = fakeSurface();
    const widget = new AriWidgetController(surface);
    widget.setEnabled(true);
    widget.update({ kind: 'working' }, false);
    expect(surface.renders).toHaveLength(1);

    widget.setEnabled(false);
    expect(surface.hides).toBe(1);
  });

  it('zmiana stanu w tle przekazuje nowy wyglad do okna', () => {
    const surface = fakeSurface();
    const widget = new AriWidgetController(surface);
    widget.setEnabled(true);
    widget.update({ kind: 'working' }, false);
    widget.update({ kind: 'error', message: 'padlo' }, false);
    expect(surface.renders[0]).not.toEqual(surface.renders[1]);
    expect(surface.renders[1].state).toBe('error');
  });
});
