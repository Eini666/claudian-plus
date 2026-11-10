import type { ChatMessage } from '@/core/types';
import {
  extractSessionTurns,
  formatSessionTranscript,
  SESSION_READ_CHAR_BUDGET,
  type SessionTurn,
} from '@/features/chat/session-tools/formatSessionTranscript';

const header = { id: 'conv-1', title: 'Plan', providerId: 'claude', isArchived: false };

function makeTurns(count: number, size = 10): SessionTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    user: `question ${index + 1} ${'q'.repeat(size)}`,
    assistant: `answer ${index + 1} ${'a'.repeat(size)}`,
  }));
}

function turnNumbers(text: string): number[] {
  return [...text.matchAll(/^### Turn (\d+)$/gm)].map(match => Number(match[1]));
}

let nextId = 0;
function user(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `m${nextId++}`, role: 'user', content, timestamp: 0, ...extra };
}
function assistant(extra: Partial<ChatMessage>): ChatMessage {
  return { id: `m${nextId++}`, role: 'assistant', content: '', timestamp: 0, durationSeconds: 3, ...extra };
}

describe('formatSessionTranscript', () => {
  it('returns all short turns with fromTurn 1 to toTurn 10 and no paging hint', () => {
    const text = formatSessionTranscript(header, makeTurns(10));

    expect(turnNumbers(text)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(text).toContain('fromTurn 1 to toTurn 10 of totalTurns 10');
    expect(text).not.toContain('beforeTurn=');
    expect(text).toContain('# Session: Plan');
    expect(text).toContain('- provider: claude');
    expect(text).toContain('- status: active');
    expect(text).toContain('**User:**\nquestion 3');
    expect(text).toContain('**Assistant:**\nanswer 3');
  });

  it('keeps only the newest turns within budget and pages back without overlap', () => {
    const turns = makeTurns(10, 9000); // ~18k chars per turn -> 2 turns per page

    const first = formatSessionTranscript(header, turns);
    expect(turnNumbers(first)).toEqual([9, 10]);
    expect(first).toContain('fromTurn 9 to toTurn 10 of totalTurns 10');
    expect(first).toContain('beforeTurn=9');

    const second = formatSessionTranscript(header, turns, { beforeTurn: 9 });
    expect(turnNumbers(second)).toEqual([7, 8]);
    expect(second).toContain('beforeTurn=7');

    const last = formatSessionTranscript(header, turns, { beforeTurn: 3 });
    expect(turnNumbers(last)).toEqual([1, 2]);
    expect(last).not.toContain('beforeTurn=');
  });

  it('cuts a single turn larger than the budget and marks it', () => {
    const turns: SessionTurn[] = [{ user: 'short', assistant: 'x'.repeat(60000) }];

    const text = formatSessionTranscript(header, turns);
    const body = text.slice(text.indexOf('### Turn 1'));

    expect(turnNumbers(text)).toEqual([1]);
    expect(text).toContain('[…truncated]');
    expect(body.length).toBeLessThanOrEqual(SESSION_READ_CHAR_BUDGET);
    expect(text).toContain('fromTurn 1 to toTurn 1 of totalTurns 1');
  });

  it('reports no turns for an empty session or beforeTurn=1', () => {
    expect(formatSessionTranscript(header, [])).toContain('none to show (totalTurns 0)');
    expect(formatSessionTranscript(header, makeTurns(3), { beforeTurn: 1 })).toContain('none to show (totalTurns 3)');
  });

  it('labels archived sessions', () => {
    expect(formatSessionTranscript({ ...header, isArchived: true }, makeTurns(1))).toContain('- status: archived');
  });
});

describe('extractSessionTurns', () => {
  it('shows only the user text of a prompt with editor_selection context', () => {
    const messages = [
      user('Fix this\n\n<editor_selection path="a.md">\nsecret selection\n</editor_selection>'),
      assistant({ content: 'Done.' }),
    ];

    expect(extractSessionTurns(messages, { isCaller: false })).toEqual([{ user: 'Fix this', assistant: 'Done.' }]);
  });

  it('keeps only the final assistant text, without tool calls or thinking', () => {
    const messages = [
      user('Check the file', { displayContent: 'Check the file' }),
      assistant({
        content: 'Let me look.Here is the answer.',
        contentBlocks: [
          { type: 'thinking', content: 'private reasoning' },
          { type: 'text', content: 'Let me look.' },
          { type: 'tool_use', toolId: 't1' },
          { type: 'text', content: 'Here is the answer.' },
        ],
        toolCalls: [{ id: 't1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed', result: 'file body' }],
      }),
    ];

    expect(extractSessionTurns(messages, { isCaller: false })).toEqual([
      { user: 'Check the file', assistant: 'Here is the answer.' },
    ]);
  });

  it('falls back to all text when the turn ended on a tool call', () => {
    const messages = [
      user('Run it'),
      assistant({ contentBlocks: [{ type: 'text', content: 'Running.' }, { type: 'tool_use', toolId: 't1' }] }),
    ];

    expect(extractSessionTurns(messages, { isCaller: false })[0].assistant).toBe('Running.');
  });

  it('skips interrupt and rebuilt-context user messages', () => {
    const messages = [
      user('Real prompt'),
      assistant({ content: 'Reply' }),
      user('[Request interrupted by user]', { isInterrupt: true }),
      user('rebuilt', { isRebuiltContext: true }),
    ];

    expect(extractSessionTurns(messages, { isCaller: false })).toEqual([{ user: 'Real prompt', assistant: 'Reply' }]);
  });

  it('drops a trailing turn without assistant text (still running)', () => {
    const messages = [
      user('First'),
      assistant({ content: 'One' }),
      user('Second'),
      assistant({ content: '', durationSeconds: undefined }),
    ];

    expect(extractSessionTurns(messages, { isCaller: false }).map(turn => turn.user)).toEqual(['First']);
  });

  it('drops the caller trailing turn until it completes, but keeps a completed one', () => {
    const running = [
      user('First'),
      assistant({ content: 'One' }),
      user('Read my session'),
      assistant({ content: 'Let me check.', durationSeconds: undefined }),
    ];
    expect(extractSessionTurns(running, { isCaller: true }).map(turn => turn.user)).toEqual(['First']);
    // Same partial text in another session counts as an answer: no tab state here.
    expect(extractSessionTurns(running, { isCaller: false })).toHaveLength(2);

    const completed = [user('First'), assistant({ content: 'One', durationSeconds: 2 })];
    expect(extractSessionTurns(completed, { isCaller: true })).toHaveLength(1);
  });
});
