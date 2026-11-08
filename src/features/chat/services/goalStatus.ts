import * as fs from 'fs/promises';

/**
 * Stan `/goal` z Claude Code, czytany z pliku sesji (JSONL). CLI nie wysyla go w strumieniu:
 * zostawia w pliku wpisy `attachment` typu `goal_status` (zmierzone 23.10.2026, CLI 2.1.308):
 * - ustawienie celu: `{sentinel: true, met: false, condition}`
 * - wyczyszczenie (`/goal clear`): `{sentinel: true, met: true, condition}`
 * - kazde sprawdzenie po turze: `{met, condition, reason}`
 * Pomysl panelu z BaoCode (`lib/kernel/claude_code/claude_goal.dart`).
 */
export interface GoalState {
  condition: string;
  checks: number;
  met: boolean;
  reason: string | null;
}

export function applyGoalLines(state: GoalState | null, lines: string[]): GoalState | null {
  for (const line of lines) {
    if (!line.includes('"goal_status"')) continue;
    let a: Record<string, unknown> | undefined;
    try {
      a = (JSON.parse(line) as { attachment?: Record<string, unknown> } | null)?.attachment;
    } catch {
      continue;
    }
    if (a?.type !== 'goal_status') continue;
    const condition = typeof a.condition === 'string' ? a.condition.trim() : '';
    if (a.sentinel) {
      state = !a.met && condition ? { condition, checks: 0, met: false, reason: null } : null;
      continue;
    }
    if (!state) continue;
    state = {
      ...state,
      checks: state.checks + 1,
      met: a.met === true,
      reason: typeof a.reason === 'string' ? a.reason : state.reason,
    };
  }
  return state;
}

/** Czyta plik sesji przyrostowo: pliki sesji maja megabajty, a odswiezamy po kazdej turze. */
export class GoalStatusTracker {
  private path: string | null = null;
  private offset = 0;
  private state: GoalState | null = null;
  private pending: Promise<GoalState | null> | null = null;

  refresh(path: string | null): Promise<GoalState | null> {
    // Rownolegle wywolania (kilka zdarzen jednej tury) czekaja na jeden odczyt.
    this.pending ??= this.read(path).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async read(path: string | null): Promise<GoalState | null> {
    if (path !== this.path) {
      this.path = path;
      this.offset = 0;
      this.state = null;
    }
    if (!path) return null;
    let fh: fs.FileHandle;
    try {
      fh = await fs.open(path, 'r');
    } catch {
      return this.state; // sesja jeszcze nie zapisana
    }
    try {
      const { size } = await fh.stat();
      if (size < this.offset) {
        this.offset = 0;
        this.state = null;
      }
      if (size === this.offset) return this.state;
      const buf = Buffer.alloc(size - this.offset);
      await fh.read(buf, 0, buf.length, this.offset);
      // Tylko pelne linie: niedopisana koncowka (i rozciety znak UTF-8) zostaje na nastepny raz.
      const end = buf.lastIndexOf(0x0a) + 1;
      if (end === 0) return this.state;
      this.offset += end;
      this.state = applyGoalLines(this.state, buf.subarray(0, end).toString('utf8').split('\n'));
      return this.state;
    } finally {
      await fh.close();
    }
  }
}
