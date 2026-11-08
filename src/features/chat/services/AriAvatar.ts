/**
 * Awatar stanu Ari — most miedzy sygnalami tury a robotem z `robot-heads`
 * (12.10, wczesniej Moodstone). Robot ma wlasna twarz, ruch i swiatelko anteny
 * dla kazdego stanu, ale przy 20 px w pasku twarzy nie widac — stan niesie
 * KOLOR OBUDOWY (ustalenie z 13.09: roznica w ruchu przy tym rozmiarze ginie).
 */

import type { AriLook } from './ariRobot';
import type { TurnSignal } from './TurnNotifier';
import { TURN_COLORS } from './TurnNotifier';

export type { AriLook } from './ariRobot';

/** Szarosc — tylko dla przerwanej tury. */
const RESTING = '#6B7280';

/** Najciemniejsza zielen z dawnej palety Moodstone, spokojna i czytelna przy 20 px. */
const PINE = '#1F8A70';

/**
 * Stan wyjsciowy po starcie Obsidiana i po ostygnieciu „skonczylam": robot rozglada
 * sie i mruga. Po `SLEEP_AFTER_MS` sam zasypia — `rests` mowi mu, ze moze.
 */
export const ARI_RESTING: AriLook = { state: 'idle', color: PINE, rests: true };

const SKY = '#3FC1F5';
const LILAC = '#C9B8F0';
/** Subagenci — fiolet, bo zolc przy pomaranczu `working` zlewala sie na obudowie (12.10). */
const VIOLET = '#7C3AED';
/** Czekam na decyzje — ciemniejsza od zieleni „skonczylam", zeby w pasku dalo sie je odroznic. */
const DARK_GREEN = '#4A7C23';

const SIGNAL_LOOKS: Record<TurnSignal['kind'], AriLook> = {
  observing: { state: 'searching', color: SKY },
  thinking: { state: 'thinking', color: LILAC },
  speaking: { state: 'speaking', color: PINE },
  working: { state: 'working', color: TURN_COLORS.orange },
  processing: { state: 'working', color: VIOLET },
  // Robota STOI, dopoki użytkownik nie odpowie — czujne oczy i zielone swiatlo.
  waiting: { state: 'listening', color: DARK_GREEN },
  finished: { state: 'happy', color: TURN_COLORS.green },
  error: { state: 'error', color: TURN_COLORS.red },
  cancelled: { state: 'idle', color: RESTING },
};

export function lookForSignal(signal: TurnSignal | null): AriLook {
  return signal ? SIGNAL_LOOKS[signal.kind] : ARI_RESTING;
}
