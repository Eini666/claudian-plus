import { createMockEl } from '@test/helpers/MockElement';

import { SESSION_TOOL_LIST_FULL_NAME, SESSION_TOOL_READ_FULL_NAME } from '@/core/execution';
import { getToolIcon } from '@/core/tools/toolIcons';
import type { ToolCallInfo } from '@/core/types';
import { setSessionTitleResolver } from '@/features/chat/rendering/sessionToolPresentation';
import { renderStoredToolCall } from '@/features/chat/rendering/ToolCallRenderer';

jest.mock('obsidian', () => ({ setIcon: jest.fn() }));

const READ_RESULT = [
  '# Session: Stary tytuł',
  '',
  '- id: conv-1',
  '- provider: claude',
  '- status: active',
  '- turns: fromTurn 5 to toTurn 12 of totalTurns 12',
  '- older turns exist: call read_session again with beforeTurn=5',
  '',
  '### Turn 5',
  '',
  '**User:**',
  'tajny prompt',
  '',
  '**Assistant:**',
  'tajna odpowiedź',
  '',
].join('\n');

const LIST_RESULT = [
  '- conv-1 (this session) — "Pierwsza" — last activity 2026-11-10T10:00:00.000Z — 4 messages',
  '- conv-2 — "Druga" — last activity 2026-11-09T10:00:00.000Z — 2 messages',
  '- conv-3 — "Trzecia" — last activity 2026-11-08T10:00:00.000Z — 9 messages',
  '- …truncated: showing 3 of 7 sessions (limit max 200)',
  '',
].join('\n');

function toolCall(name: string, input: Record<string, unknown>, result: string): ToolCallInfo {
  return { id: 't1', name, input, status: 'completed', result };
}

function textOf(el: ReturnType<typeof createMockEl>, cls: string): string {
  return el.querySelector(`.${cls}`)?.textContent ?? '';
}

describe('session tool cards', () => {
  beforeEach(() => {
    setSessionTitleResolver(id => (id === 'conv-1' ? 'Aktualny tytuł' : undefined));
  });

  it('read_session shows the current title and the turn range, not the transcript', () => {
    const parent = createMockEl();
    const el = renderStoredToolCall(
      parent,
      toolCall(SESSION_TOOL_READ_FULL_NAME, { sessionId: 'conv-1' }, READ_RESULT),
      { initiallyExpanded: true },
    ) as unknown as ReturnType<typeof createMockEl>;

    expect(textOf(el, 'claudian-tool-name')).toBe('Czytam rozmowę „Aktualny tytuł”');
    expect(textOf(el, 'claudian-tool-summary')).toBe('tury 5–12 z 12');
    const content = el.querySelector('.claudian-tool-content');
    const contentText = content?.querySelectorAll('.claudian-tool-line').map((line: { textContent: string }) => line.textContent).join('\n');
    expect(contentText).toBe('tury 5–12 z 12');
    expect(contentText).not.toContain('**User:**');
    expect(contentText).not.toContain('tajny prompt');
  });

  it('read_session for a deleted conversation falls back to the id', () => {
    const parent = createMockEl();
    const el = renderStoredToolCall(
      parent,
      toolCall(SESSION_TOOL_READ_FULL_NAME, { sessionId: 'gone-9' }, 'Session not found.'),
    ) as unknown as ReturnType<typeof createMockEl>;

    expect(textOf(el, 'claudian-tool-name')).toBe('Czytam rozmowę „gone-9”');
    expect(textOf(el, 'claudian-tool-summary')).toBe('');
  });

  it('list_sessions counts listed conversations with Polish plural forms', () => {
    const parent = createMockEl();
    const el = renderStoredToolCall(
      parent,
      toolCall(SESSION_TOOL_LIST_FULL_NAME, {}, LIST_RESULT),
      { initiallyExpanded: true },
    ) as unknown as ReturnType<typeof createMockEl>;

    expect(textOf(el, 'claudian-tool-name')).toBe('Lista rozmów');
    expect(textOf(el, 'claudian-tool-summary')).toBe('3 rozmowy');
    const titles = el.querySelector('.claudian-tool-content')
      ?.querySelectorAll('.claudian-tool-line').map((line: { textContent: string }) => line.textContent);
    expect(titles).toEqual(['Pierwsza', 'Druga', 'Trzecia']);
  });

  it.each([
    [1, '1 rozmowa'],
    [5, '5 rozmów'],
    [22, '22 rozmowy'],
    [12, '12 rozmów'],
  ])('list_sessions with %i entries → %s', (count, expected) => {
    const result = Array.from({ length: count }, (_, i) => `- c${i} — "T${i}" — last activity x — 1 messages`).join('\n');
    const el = renderStoredToolCall(
      createMockEl(),
      toolCall(SESSION_TOOL_LIST_FULL_NAME, {}, result),
    ) as unknown as ReturnType<typeof createMockEl>;
    expect(textOf(el, 'claudian-tool-summary')).toBe(expected);
  });

  it('session tools get their own icons before the generic MCP marker', () => {
    expect(getToolIcon(SESSION_TOOL_LIST_FULL_NAME)).toBe('list');
    expect(getToolIcon(SESSION_TOOL_READ_FULL_NAME)).toBe('messages-square');
  });
});
