import { z } from 'zod';

import {
  type ProviderSessionToolPort,
  SESSION_TOOL_LIST,
  SESSION_TOOL_READ,
  SESSION_TOOL_SERVER,
} from '@/core/execution';
import { createClaudeSessionToolServer } from '@/providers/claude/execution/claudeSessionToolServer';

interface MockTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}

function createPort(): jest.Mocked<ProviderSessionToolPort> {
  return {
    listSessions: jest.fn().mockResolvedValue({ ok: true, text: '- a — "A"\n' }),
    readSession: jest.fn().mockResolvedValue({ ok: true, text: '## Turn 3\n' }),
  };
}

function getTools(port: ProviderSessionToolPort): Map<string, MockTool> {
  const server = createClaudeSessionToolServer(port) as unknown as {
    name: string;
    instance: { tools: MockTool[] };
  };
  expect(server.name).toBe(SESSION_TOOL_SERVER);
  return new Map(server.instance.tools.map(entry => [entry.name, entry]));
}

describe('createClaudeSessionToolServer', () => {
  it('exposes list_sessions and read_session with the plan descriptions', () => {
    const tools = getTools(createPort());

    expect([...tools.keys()]).toEqual([SESSION_TOOL_LIST, SESSION_TOOL_READ]);
    expect(tools.get(SESSION_TOOL_LIST)?.description).toBe(
      'List other Claudian chat sessions in this vault (non-archived, most recent first). The calling session is marked "(this session)". Use read_session to read one.',
    );
    expect(tools.get(SESSION_TOOL_READ)?.description).toBe(
      'Read another Claudian chat session: each turn\'s user prompt and final reply as Markdown, newest turns first within about 40k characters. Pass beforeTurn to page back to older turns.',
    );
  });

  it('validates inputs: limit 1-200, sessionId required, beforeTurn >= 1', () => {
    const tools = getTools(createPort());
    const list = z.object(tools.get(SESSION_TOOL_LIST)!.inputSchema);
    const read = z.object(tools.get(SESSION_TOOL_READ)!.inputSchema);

    expect(list.safeParse({}).success).toBe(true);
    expect(list.safeParse({ limit: 200 }).success).toBe(true);
    expect(list.safeParse({ limit: 0 }).success).toBe(false);
    expect(list.safeParse({ limit: 201 }).success).toBe(false);
    expect(list.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(read.safeParse({ sessionId: 'conv-1' }).success).toBe(true);
    expect(read.safeParse({}).success).toBe(false);
    expect(read.safeParse({ sessionId: '' }).success).toBe(false);
    expect(read.safeParse({ sessionId: 'conv-1', beforeTurn: 0 }).success).toBe(false);
  });

  it('passes read_session arguments to the port and returns its text', async () => {
    const port = createPort();
    const tools = getTools(port);

    const result = await tools.get(SESSION_TOOL_READ)!.handler(
      { sessionId: 'conv-1', beforeTurn: 4 },
      {},
    );

    expect(port.readSession).toHaveBeenCalledWith({ sessionId: 'conv-1', beforeTurn: 4 });
    expect(result).toEqual({ content: [{ type: 'text', text: '## Turn 3\n' }] });
  });

  it('passes list_sessions limit to the port', async () => {
    const port = createPort();
    const tools = getTools(port);

    await tools.get(SESSION_TOOL_LIST)!.handler({ limit: 5 }, {});

    expect(port.listSessions).toHaveBeenCalledWith({ limit: 5 });
  });

  it('maps ok:false to an error result', async () => {
    const port = createPort();
    port.readSession.mockResolvedValue({ ok: false, message: 'Session "x" not found.' });
    const tools = getTools(port);

    const result = await tools.get(SESSION_TOOL_READ)!.handler({ sessionId: 'x' }, {});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Session "x" not found.' }],
      isError: true,
    });
  });

  it('turns a throwing port into an error result instead of rejecting', async () => {
    const port = createPort();
    port.listSessions.mockRejectedValue(new Error('disk gone'));
    const tools = getTools(port);

    const result = await tools.get(SESSION_TOOL_LIST)!.handler({}, {});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Session tool failed: disk gone' }],
      isError: true,
    });
  });
});
