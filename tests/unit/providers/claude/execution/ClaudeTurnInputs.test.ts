import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import {
  ClaudeTurnInputs,
  getReplayedUserMessageId,
  isSessionIdle,
} from '@/providers/claude/execution/ClaudeTurnInputs';

function replay(uuid: string): SDKMessage {
  return {
    type: 'user',
    isReplay: true,
    uuid,
    parent_tool_use_id: null,
    session_id: 's',
    message: { role: 'user', content: 'x' },
  } as unknown as SDKMessage;
}

function result(fields: Record<string, unknown>): SDKMessage {
  return { type: 'result', subtype: 'success', ...fields } as unknown as SDKMessage;
}

function idle(): SDKMessage {
  return { type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'u', session_id: 's' } as unknown as SDKMessage;
}

// Sekwencje zmierzone sonda na CLI 2.1.310 (25.10.2026).
describe('ClaudeTurnInputs', () => {
  it('keeps the old behaviour without steers: the first result settles the run', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.observe(replay('p'));
    inputs.observe(result({ user_message_uuids: ['other'], queued_turn_count: 0 }));
    expect(inputs.settled).toBe(true);
  });

  it('settles on one result when the steer was folded into the running turn', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.observe(replay('p'));
    inputs.addSteer('s');
    expect(inputs.hasUndeliveredSteers()).toBe(true);
    expect(inputs.observe(replay('s'))).toBe('s');
    expect(inputs.hasUndeliveredSteers()).toBe(false);
    inputs.observe(result({ user_message_uuids: ['p', 's'], queued_turn_count: 0 }));
    expect(inputs.settled).toBe(true);
    expect(inputs.wasConsumed('s')).toBe(true);
  });

  it('stays open after the first result when a late steer runs as the next native turn', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.addSteer('s');
    // CLI zglasza queued_turn_count 0, choc steer czeka — decyduje brak replay.
    inputs.observe(result({ user_message_uuids: ['p'], queued_turn_count: 0 }));
    expect(inputs.settled).toBe(false);
    expect(inputs.wasConsumed('p')).toBe(true);
    expect(inputs.wasConsumed('s')).toBe(false);

    expect(inputs.observe(replay('s'))).toBe('s');
    inputs.observe(result({ user_message_uuids: ['s'], queued_turn_count: 0 }));
    expect(inputs.settled).toBe(true);
  });

  it('settles on idle when Claude dropped a late steer, without confirming it', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.addSteer('s');
    inputs.observe(result({ user_message_uuids: ['p'], queued_turn_count: 0 }));
    expect(inputs.settled).toBe(false);
    inputs.observe(idle());
    expect(inputs.settled).toBe(true);
    expect(inputs.wasConsumed('s')).toBe(false);
  });

  it('leaves idle to the result for a run without steers', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.observe(idle());
    expect(inputs.settled).toBe(false);
    expect(isSessionIdle(idle())).toBe(true);
    expect(isSessionIdle({ ...idle(), state: 'running' } as SDKMessage)).toBe(false);
  });

  it('ignores a result that consumed none of its inputs', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.addSteer('s');
    inputs.observe(result({ user_message_uuids: ['background'], queued_turn_count: 0 }));
    expect(inputs.settled).toBe(false);
  });

  it('falls back to settling on the first result when the CLI sends no consumption echo', () => {
    const inputs = new ClaudeTurnInputs('p');
    inputs.addSteer('s');
    inputs.observe(result({ subtype: 'error_during_execution' }));
    expect(inputs.settled).toBe(true);
    // Bez echa nie wiadomo, czy CLI wzielo steer — nie wolno go uznac za przyjety.
    expect(inputs.wasConsumed('s')).toBe(false);
    expect(() => inputs.addSteer('late')).toThrow();
  });

  it('recognises only top-level replays', () => {
    expect(getReplayedUserMessageId(replay('a'))).toBe('a');
    expect(getReplayedUserMessageId({ ...replay('b'), parent_tool_use_id: 'tool' } as SDKMessage)).toBeUndefined();
    expect(getReplayedUserMessageId({ ...replay('c'), isReplay: false } as SDKMessage)).toBeUndefined();
    expect(getReplayedUserMessageId(result({}))).toBeUndefined();
  });
});
