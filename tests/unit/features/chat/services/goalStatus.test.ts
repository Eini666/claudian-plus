import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyGoalLines, GoalStatusTracker } from '@/features/chat/services/goalStatus';

// Wpisy w ksztalcie z prawdziwej sesji CLI 2.1.308 (23.10.2026).
const goal = (attachment: Record<string, unknown>) =>
  JSON.stringify({ type: 'attachment', attachment: { type: 'goal_status', ...attachment } });
const COND = 'plik ok.txt istnieje i zawiera słowo gotowe';
const SET = goal({ met: false, sentinel: true, condition: COND });
const CLEAR = goal({ met: true, sentinel: true, condition: COND });
const check = (met: boolean, reason: string) => goal({ met, condition: COND, reason });
const OTHER = JSON.stringify({ type: 'user', message: { content: 'Stop hook feedback:\n[x]: goal_status w tekście' } });

describe('applyGoalLines', () => {
  it('ustawienie celu bez sprawdzen', () => {
    expect(applyGoalLines(null, [SET])).toEqual({ condition: COND, checks: 0, met: false, reason: null });
  });

  it('liczy sprawdzenia i pamieta ostatni powod', () => {
    const s = applyGoalLines(null, [SET, OTHER, check(false, 'brak pliku'), check(false, 'nadal brak')]);
    expect(s).toEqual({ condition: COND, checks: 2, met: false, reason: 'nadal brak' });
  });

  it('cel spelniony', () => {
    expect(applyGoalLines(null, [SET, check(false, 'a'), check(true, 'jest')])?.met).toBe(true);
  });

  it('/goal clear chowa cel', () => {
    expect(applyGoalLines(null, [SET, check(false, 'a'), CLEAR])).toBeNull();
  });

  it('nowy cel zeruje licznik', () => {
    const NEW = goal({ met: false, sentinel: true, condition: 'inny' });
    expect(applyGoalLines(null, [SET, check(false, 'a'), NEW])).toEqual({ condition: 'inny', checks: 0, met: false, reason: null });
  });

  it('sprawdzenie bez ustawienia i smieci w pliku sa pomijane', () => {
    expect(applyGoalLines(null, ['{nie json "goal_status"', check(false, 'a'), ''])).toBeNull();
  });
});

describe('GoalStatusTracker', () => {
  it('czyta przyrostowo i nie bierze niedopisanej linii', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-goal-'));
    const file = path.join(dir, 's.jsonl');
    const tracker = new GoalStatusTracker();

    expect(await tracker.refresh(file)).toBeNull(); // pliku jeszcze nie ma
    await fs.writeFile(file, `${SET}\n${check(false, 'a')}`); // druga linia niedopisana
    expect((await tracker.refresh(file))?.checks).toBe(0);
    await fs.appendFile(file, `\n${check(true, 'jest')}\n`);
    expect(await tracker.refresh(file)).toMatchObject({ checks: 2, met: true, reason: 'jest' });
    expect(await tracker.refresh(null)).toBeNull(); // inna rozmowa bez sesji
  });
});
