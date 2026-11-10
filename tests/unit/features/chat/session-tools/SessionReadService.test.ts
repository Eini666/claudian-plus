import type { Conversation, ConversationMeta } from '@/core/types';
import {
  SESSION_LIST_DEFAULT_LIMIT,
  SESSION_LIST_MAX_LIMIT,
  type SessionReadRepository,
  SessionReadService,
} from '@/features/chat/session-tools/SessionReadService';

function conversation(id: string, lastActivityAt: number, extra: Partial<Conversation> = {}): Conversation {
  return {
    id,
    providerId: 'claude',
    title: `Title ${id}`,
    createdAt: 1,
    lastActivityAt,
    sessionId: null,
    messages: [
      { id: `${id}-u`, role: 'user', content: `prompt in ${id}`, timestamp: 0 },
      { id: `${id}-a`, role: 'assistant', content: `answer in ${id}`, timestamp: 0, durationSeconds: 1 },
    ],
    ...extra,
  };
}

function fakeRepository(conversations: Conversation[]): SessionReadRepository & {
  ensureHydrated: jest.Mock;
} {
  return {
    list: (): ConversationMeta[] => conversations.map(item => ({
      id: item.id,
      providerId: item.providerId,
      title: item.title,
      createdAt: item.createdAt,
      lastActivityAt: item.lastActivityAt,
      messageCount: item.messages.length,
      preview: '',
      isArchived: item.isArchived,
    })),
    getSync: id => conversations.find(item => item.id === id) ?? null,
    ensureHydrated: jest.fn(async (id: string) => conversations.find(item => item.id === id) ?? null),
  };
}

function listedIds(text: string): string[] {
  return [...text.matchAll(/^- (\S+)/gm)].map(match => match[1]).filter(id => id !== '…truncated:');
}

describe('SessionReadService.listSessions', () => {
  it('hides archived sessions, sorts newest first and marks the caller', async () => {
    const repository = fakeRepository([
      conversation('old', 100),
      conversation('archived', 300, { isArchived: true }),
      conversation('new', 200),
    ]);
    const port = new SessionReadService(repository).bindCaller('old');

    const result = await port.listSessions({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listedIds(result.text)).toEqual(['new', 'old']);
    expect(result.text).toContain('- old (this session) — "Title old"');
    expect(result.text).not.toContain('new (this session)');
    expect(result.text).toContain('2 messages');
    expect(result.text).not.toContain('truncated');
  });

  it('applies the default limit with a truncation line and caps large limits', async () => {
    const many = Array.from({ length: 250 }, (_, index) => conversation(`c${index}`, index + 1));
    const port = new SessionReadService(fakeRepository(many)).bindCaller(null);

    const byDefault = await port.listSessions({});
    expect(byDefault.ok && listedIds(byDefault.text)).toHaveLength(SESSION_LIST_DEFAULT_LIMIT);
    expect(byDefault.ok && byDefault.text).toContain('…truncated: showing 50 of 250 sessions');

    const capped = await port.listSessions({ limit: 500 });
    expect(capped.ok && listedIds(capped.text)).toHaveLength(SESSION_LIST_MAX_LIMIT);

    const floor = await port.listSessions({ limit: 0 });
    expect(floor.ok && listedIds(floor.text)).toEqual(['c249']);
  });

  it('falls back to createdAt when lastActivityAt is missing', async () => {
    const repository = fakeRepository([
      conversation('a', 0, { createdAt: 50 }),
      conversation('b', 10),
    ]);
    const result = await new SessionReadService(repository).bindCaller(null).listSessions({});

    expect(result.ok && listedIds(result.text)).toEqual(['a', 'b']);
  });
});

describe('SessionReadService.readSession', () => {
  it('returns an error result, not an exception, for an unknown id', async () => {
    const repository = fakeRepository([conversation('a', 1)]);
    const result = await new SessionReadService(repository).bindCaller('a').readSession({ sessionId: 'nope' });

    expect(result).toEqual({ ok: false, message: 'No session with id nope.' });
    expect(repository.ensureHydrated).not.toHaveBeenCalled();
  });

  it('rejects an invalid beforeTurn', async () => {
    const port = new SessionReadService(fakeRepository([conversation('a', 1)])).bindCaller(null);

    expect((await port.readSession({ sessionId: 'a', beforeTurn: 0 })).ok).toBe(false);
    expect((await port.readSession({ sessionId: 'a', beforeTurn: 1.5 })).ok).toBe(false);
  });

  it('reads an archived session by id through ensureHydrated', async () => {
    const repository = fakeRepository([conversation('arch', 1, { isArchived: true })]);
    const result = await new SessionReadService(repository).bindCaller(null).readSession({ sessionId: 'arch' });

    expect(repository.ensureHydrated).toHaveBeenCalledWith('arch');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('- status: archived');
    expect(result.text).toContain('**User:**\nprompt in arch');
    expect(result.text).toContain('**Assistant:**\nanswer in arch');
  });

  it('turns a hydration failure into an error result', async () => {
    const repository = fakeRepository([conversation('a', 1)]);
    repository.ensureHydrated.mockRejectedValueOnce(new Error('disk gone'));
    const result = await new SessionReadService(repository).bindCaller(null).readSession({ sessionId: 'a' });

    expect(result).toEqual({ ok: false, message: 'Could not read session a: disk gone' });
  });

  it('does not change lastActivityAt or title of the read session', async () => {
    const target = conversation('closed', 1234, { title: 'Keep me' });
    const repository = fakeRepository([target]);
    await new SessionReadService(repository).bindCaller('other').readSession({ sessionId: 'closed' });

    expect(target.lastActivityAt).toBe(1234);
    expect(target.title).toBe('Keep me');
  });
});
