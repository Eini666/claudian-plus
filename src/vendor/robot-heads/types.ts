// Wyciete z robot-heads/src/types.ts: same typy, bez propsow Reacta (fork nie ma Reacta).
export type RobotHeadState =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'listening'
  | 'speaking'
  | 'working'
  | 'happy'
  | 'error'
  | 'sleeping';

/** The head's build. Only the TV head so far. */
export type RobotHeadModel = 'tv';

/** The outline of the head, seen from the front. Every shape carries the same screen, ears and antenna. */
export type RobotHeadShape = 'rectangle' | 'square' | 'circle' | 'hexagon';
