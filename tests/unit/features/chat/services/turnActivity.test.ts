import { activityForChunk, isReadOnlyCommand } from '@/features/chat/services/turnActivity';
import { notifyActivity, subscribeTurn, type TurnSignal } from '@/features/chat/services/TurnNotifier';

describe('activityForChunk', () => {
  it('blok myslenia i tekst to dwa rozne stany', () => {
    expect(activityForChunk({ type: 'thinking' })).toEqual({ kind: 'thinking' });
    expect(activityForChunk({ type: 'text' })).toEqual({ kind: 'speaking' });
  });

  it.each(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch'])(
    '%s tylko patrzy — obserwuje',
    (name) => {
      expect(activityForChunk({ type: 'tool_use', name })).toEqual({ kind: 'observing' });
    },
  );

  it.each(['Edit', 'Write', 'Bash', 'PowerShell', 'NotebookEdit'])(
    '%s rusza pliki albo system — pracuje',
    (name) => {
      expect(activityForChunk({ type: 'tool_use', name })).toEqual({ kind: 'working' });
    },
  );

  it('podagent to osobny stan, z obu stron', () => {
    expect(activityForChunk({ type: 'tool_use', name: 'Task' })).toEqual({ kind: 'processing' });
    expect(activityForChunk({ type: 'subagent_tool_use' })).toEqual({ kind: 'processing' });
  });

  it('nazwa narzedzia nie jest wrazliwa na wielkosc liter', () => {
    expect(activityForChunk({ type: 'tool_use', name: 'rEaD' })).toEqual({ kind: 'observing' });
  });

  it('nieznane narzedzie (MCP) idzie w prace, nie w cisze', () => {
    expect(activityForChunk({ type: 'tool_use', name: 'mcp__pencil__execute' }))
      .toEqual({ kind: 'working' });
    expect(activityForChunk({ type: 'tool_use' })).toEqual({ kind: 'working' });
  });

  it.each(['tool_result', 'citations', 'tool_output', 'subagent_tool_result'])(
    '%s nie zmienia tego, CO Ari robi',
    (type) => {
      expect(activityForChunk({ type })).toBeNull();
    },
  );
});

describe('notifyActivity', () => {
  it('przepuszcza tylko zmiane stanu — setki fragmentow tekstu to jedno przerysowanie', () => {
    const seen: (TurnSignal | null)[] = [];
    const off = subscribeTurn(signal => { seen.push(signal); });
    const before = seen.length;

    notifyActivity({ kind: 'working' });
    notifyActivity({ kind: 'working' });
    notifyActivity({ kind: 'working' });
    expect(seen.length - before).toBe(1);

    notifyActivity({ kind: 'observing' });
    expect(seen.length - before).toBe(2);
    expect(seen[seen.length - 1]).toEqual({ kind: 'observing' });

    notifyActivity({ kind: 'working' });
    expect(seen.length - before).toBe(3);

    off();
  });
});

describe('komendy powloki (91% wywolan idzie przez Bash)', () => {
  const bash = (command: string) => activityForChunk({ type: 'tool_use', name: 'Bash', input: { command } });

  it.each([
    'cat plik.ts',
    "sed -n '1,50p' plik.ts",
    'grep -n "wzorzec" src/plik.ts',
    'ls -la src/',
    'cd /c/projekt && cat package.json',
    'ls -l | wc -l',
    'grep x plik 2>/dev/null',
    'git status --porcelain',
    'git log --oneline -5',
    'find src -name "*.ts" | sort | head -20',
  ])('%s → tylko oglada', (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
    expect(bash(command)).toEqual({ kind: 'observing' });
  });

  it.each([
    'npm run build',
    'rm -rf dist',
    'git commit -m "x"',
    'npx jest',
    'python skrypt.py',
    'mkdir -p nowy',
  ])('%s → praca', (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
    expect(bash(command)).toEqual({ kind: 'working' });
  });

  it('przekierowanie do pliku to zapis, nawet gdy komenda czyta', () => {
    expect(isReadOnlyCommand('cat plik > kopia.txt')).toBe(false);
    expect(isReadOnlyCommand('echo tekst >> log.md')).toBe(false);
    // ...ale `2>&1` i `/dev/null` niczego nie zapisuja
    expect(isReadOnlyCommand('grep wzorzec plik 2>&1')).toBe(true);
  });

  it('jeden piszacy czlon psuje caly lancuch', () => {
    expect(isReadOnlyCommand('cat plik && rm plik')).toBe(false);
  });

  it('PowerShell tez jest rozbierany', () => {
    expect(activityForChunk({ type: 'tool_use', name: 'PowerShell', input: { command: 'Get-Content plik' } }))
      .toEqual({ kind: 'observing' });
  });

  it('Bash bez komendy idzie w prace, nie wywala sie', () => {
    expect(bash('')).toEqual({ kind: 'working' });
    expect(activityForChunk({ type: 'tool_use', name: 'Bash' })).toEqual({ kind: 'working' });
  });
});
