import { filterActiveBranch, PRE_CUT_MESSAGE_LIMIT } from '@/providers/claude/history/sdkBranchFilter';
import type { SDKNativeMessage } from '@/providers/claude/history/sdkHistoryTypes';

function user(uuid: string, parentUuid: string | null, text = uuid): SDKNativeMessage {
  return { type: 'user', uuid, parentUuid, message: { role: 'user', content: text } };
}

function assistant(uuid: string, parentUuid: string | null): SDKNativeMessage {
  return { type: 'assistant', uuid, parentUuid, message: { role: 'assistant', content: uuid } };
}

/**
 * Kompresja kontekstu zaczyna nowy korzen w tym samym pliku, a rozgalezienie
 * (poprawiona wiadomosc) wymusza chodzenie po rodzicach zamiast czytania liniowo.
 */
function transcriptWithCutAndBranch(): SDKNativeMessage[] {
  return [
    user('a1', null),
    assistant('a2', 'a1'),
    user('a3', 'a2'),
    assistant('a4', 'a3'),
    user('b1', null), // granica kompresji
    assistant('b2', 'b1'),
    user('b3alt', 'b2'), // porzucona galaz
    user('b3', 'b2'),
    assistant('b4', 'b3'),
  ];
}

describe('filterActiveBranch', () => {
  it('doszywa segment sprzed granicy kompresji', () => {
    const result = filterActiveBranch(transcriptWithCutAndBranch()).map(e => e.uuid);

    expect(result).toEqual(['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4']);
    expect(result).not.toContain('b3alt');
  });

  it('przycina doszyty segment do sufitu', () => {
    const before: SDKNativeMessage[] = [];
    const total = PRE_CUT_MESSAGE_LIMIT + 100;
    for (let i = 0; i < total; i++) {
      before.push(user(`a${i}`, i === 0 ? null : `a${i - 1}`));
    }
    const entries = [
      ...before,
      user('b1', null),
      assistant('b2', 'b1'),
      user('b3alt', 'b2'),
      user('b3', 'b2'),
      assistant('b4', 'b3'),
    ];

    const kept = filterActiveBranch(entries).map(e => e.uuid);
    const keptBefore = kept.filter(uuid => uuid?.startsWith('a'));

    expect(keptBefore).toHaveLength(PRE_CUT_MESSAGE_LIMIT);
    // ogon, nie poczatek — interesuje nas to, na czym stanelo przed kompresja
    expect(keptBefore[keptBefore.length - 1]).toBe(`a${total - 1}`);
    expect(kept).toContain('b4');
  });

  it('nie rusza transkryptu bez ciecia', () => {
    const entries = [
      user('a1', null),
      assistant('a2', 'a1'),
      user('b3alt', 'a2'),
      user('b3', 'a2'),
      assistant('b4', 'b3'),
    ];

    expect(filterActiveBranch(entries).map(e => e.uuid))
      .toEqual(['a1', 'a2', 'b3', 'b4']);
  });

  it('wyniki narzedzi nie zjadaja sufitu', () => {
    const toolResult = (uuid: string, parentUuid: string): SDKNativeMessage => ({
      type: 'user',
      uuid,
      parentUuid,
      toolUseResult: { ok: true },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
    });

    const before: SDKNativeMessage[] = [user('a0', null)];
    for (let i = 1; i < 20; i++) {
      before.push(toolResult(`a${i}`, `a${i - 1}`));
    }
    const entries = [
      ...before,
      user('b1', null),
      assistant('b2', 'b1'),
      user('b3alt', 'b2'),
      user('b3', 'b2'),
      assistant('b4', 'b3'),
    ];

    const kept = filterActiveBranch(entries).map(e => e.uuid);

    expect(kept.filter(uuid => uuid?.startsWith('a'))).toHaveLength(20);
  });
});
