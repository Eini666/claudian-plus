/**
 * Robot Ari — montaz silnika `src/vendor/robot-heads` (MIT, Fayaz Ahmed) bez Reacta.
 * Odpowiednik `RobotHead.tsx` z biblioteki, przyciety do tego, czego uzywamy:
 * ksztalt `rectangle`, kolor obudowy niesie stan (przy 20 px twarzy nie widac).
 *
 * Ten plik idzie DWA razy do bundla: do `main.js` (badge w pasku) i jako osobny
 * skrypt do okna widgetu (`ariRobotWidget.ts`), wiec nie importuje nic z Obsidiana.
 */

import { parseColor } from '../../../vendor/robot-heads/color';
import { subscribe } from '../../../vendor/robot-heads/ticker';
import { getShape } from '../../../vendor/robot-heads/tv/geometry';
import { linear } from '../../../vendor/robot-heads/tv/light';
import { type Frame, frameFor, type Palette, RobotRenderer } from '../../../vendor/robot-heads/tv/render';
import { RobotSim } from '../../../vendor/robot-heads/tv/sim';
import type { RobotHeadState } from '../../../vendor/robot-heads/types';

export type { RobotHeadState };

export interface AriLook {
  state: RobotHeadState;
  color: string;
  /** Spoczynek: po dluzszej ciszy robot zasypia (`sleeping`), ten sam kolor. */
  rests?: boolean;
}

/** Po tylu ms spoczynku robot zasypia — „dawno nic nie robilismy". */
export const SLEEP_AFTER_MS = 15 * 60_000;

/** 30 klatek wystarcza: przy 20 px i 120 px wiecej nie widac, a CPU idzie w pol. */
const MIN_FRAME_S = 1 / 30;

const SHAPE = getShape('rectangle');

function palette(color: string): Palette {
  const shell = parseColor(color) ?? [48, 80, 172];
  return {
    shell: { albedo: linear(shell), f0: 0.05, metal: 0.15, spec: 0.55, shininess: 70, rim: 0.9 },
    trim: { albedo: linear([150, 168, 200]), f0: 0.2, metal: 0.65, spec: 0.8, shininess: 45, rim: 0.7 },
    led: [232, 242, 255],
  };
}

/** Najwiekszy robot, ktorego canvas (z podskokiem, antena i cieniem) miesci sie w oknie. */
export function fitSize(width: number, height: number, antenna: boolean): number {
  const f = frameFor(SHAPE, antenna, 100);
  const scale = Math.min(width / (f.box + 2 * f.padSide), height / (f.box + f.padTop + f.padBottom));
  return Math.floor(100 * scale * 0.96);
}

export interface RobotOptions {
  size: number;
  antenna: boolean;
  floorShadow: boolean;
  /** Robot wypelnia rodzica (okno widgetu) zamiast stac w ukladzie jako `size` × `size`. */
  centerIn?: { width: number; height: number };
}

export interface MountedRobot {
  set(look: AriLook): void;
  poke(): void;
  destroy(): void;
}

/**
 * `canvas` dostarcza wywolujacy: w Obsidianie przez `createEl`, w oknie widgetu
 * z gotowego HTML — ten plik dziala w obu miejscach, a `createEl` jest tylko w pierwszym.
 */
export function mountRobot(box: HTMLElement, canvas: HTMLCanvasElement, look: AriLook, opts: RobotOptions): MountedRobot {
  const win = box.ownerDocument.defaultView ?? window;
  const frame: Frame = frameFor(SHAPE, opts.antenna, opts.size);
  canvas.setAttribute('aria-hidden', 'true');
  box.style.position = opts.centerIn ? 'absolute' : 'relative';
  box.style.width = `${opts.size}px`;
  box.style.height = `${opts.size}px`;
  if (opts.centerIn) {
    const w = frame.box + 2 * frame.padSide;
    const h = frame.box + frame.padTop + frame.padBottom;
    box.style.left = `${Math.round((opts.centerIn.width - w) / 2 + frame.padSide)}px`;
    box.style.top = `${Math.round((opts.centerIn.height - h) / 2 + frame.padTop)}px`;
  }
  Object.assign(canvas.style, {
    position: 'absolute',
    left: `${-frame.padSide}px`,
    top: `${-frame.padTop}px`,
    width: `${frame.box + 2 * frame.padSide}px`,
    height: `${frame.box + frame.padTop + frame.padBottom}px`,
    pointerEvents: 'none',
  });

  const dpr = Math.min(2, win.devicePixelRatio || 1);
  canvas.width = Math.round((frame.box + 2 * frame.padSide) * dpr);
  canvas.height = Math.round((frame.box + frame.padTop + frame.padBottom) * dpr);
  const ctx = canvas.getContext('2d');

  const sim = new RobotSim(Math.random(), look.state);
  const renderer = new RobotRenderer();
  let state = look.state;
  let pal = palette(look.color);
  let sleepTimer: number | null = null;
  let pending = 0;

  const show = (s: RobotHeadState) => {
    state = s;
    sim.setState(s);
  };

  const set = (next: AriLook) => {
    if (sleepTimer !== null) win.clearTimeout(sleepTimer);
    sleepTimer = null;
    pal = palette(next.color);
    show(next.state);
    if (next.rests) sleepTimer = win.setTimeout(() => show('sleeping'), SLEEP_AFTER_MS);
  };

  const unsubscribe = subscribe((dt) => {
    pending += dt;
    if (pending < MIN_FRAME_S) return;
    // Ukryta karta czatu (`display:none`) nie ma prostokatow — nie ma czego rysowac.
    if (!ctx || !box.isConnected || box.getClientRects().length === 0) {
      pending = 0;
      return;
    }
    sim.update(Math.min(0.1, pending));
    pending = 0;
    renderer.draw(ctx, frame, dpr, sim.pose, sim, state, SHAPE, pal, { floorShadow: opts.floorShadow, antenna: opts.antenna });
  });

  set(look);

  return {
    set,
    poke: () => sim.poke(),
    destroy: () => {
      unsubscribe();
      if (sleepTimer !== null) win.clearTimeout(sleepTimer);
      sleepTimer = null;
      canvas.remove();
    },
  };
}
