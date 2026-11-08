import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { MessageChannel } from '@/providers/claude/runtime/ClaudeMessageChannel';

function text(content: string, uuid?: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: '',
    ...(uuid ? { uuid: uuid as SDKUserMessage['uuid'] } : {}),
  };
}

describe('MessageChannel.steer', () => {
  it('delivers a steer to the waiting consumer while a turn is active', async () => {
    const channel = new MessageChannel();
    const iterator = channel[Symbol.asyncIterator]();
    channel.enqueue(text('first'));
    await iterator.next();
    expect(channel.isTurnActive()).toBe(true);

    const pending = iterator.next();
    expect(channel.steer({ ...text('steer', 'id-s'), priority: 'next' })).toBe(true);
    const result = await pending;
    expect(result.value).toMatchObject({ uuid: 'id-s', priority: 'next' });
    // Steer nie zamyka ani nie otwiera tury — to robi CLI.
    expect(channel.isTurnActive()).toBe(true);
  });

  it('serves a buffered steer before the turn gate, without merging it into queued text', async () => {
    const channel = new MessageChannel();
    const iterator = channel[Symbol.asyncIterator]();
    channel.enqueue(text('first'));
    await iterator.next();
    channel.enqueue(text('queued normally'));
    channel.steer(text('steer', 'id-s'));

    const steer = await iterator.next();
    expect(steer.value).toMatchObject({ uuid: 'id-s' });
    expect(channel.getQueueLength()).toBe(1);
  });

  it('refuses a steer once closed and drops buffered steers on close', async () => {
    const channel = new MessageChannel();
    channel.steer(text('buffered', 'id-b'));
    channel.close();
    expect(channel.steer(text('late', 'id-l'))).toBe(false);
    const result = await channel[Symbol.asyncIterator]().next();
    expect(result.done).toBe(true);
  });
});
