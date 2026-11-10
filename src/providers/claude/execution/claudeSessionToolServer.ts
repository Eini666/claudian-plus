import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  type ProviderSessionToolPort,
  type ProviderSessionToolResult,
  SESSION_TOOL_LIST,
  SESSION_TOOL_READ,
  SESSION_TOOL_SERVER,
} from '../../../core/execution';

// Mirrors SESSION_LIST_MAX_LIMIT in the chat feature (providers may not import features); the service clamps too.
const LIST_MAX_LIMIT = 200;

const LIST_DESCRIPTION = 'List other Claudian chat sessions in this vault (non-archived, most recent first). The calling session is marked "(this session)". Use read_session to read one.';
const READ_DESCRIPTION = 'Read another Claudian chat session: each turn\'s user prompt and final reply as Markdown, newest turns first within about 40k characters. Pass beforeTurn to page back to older turns.';

type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** In-process MCP server exposing the read-only session tools. Handlers never throw. */
export function createClaudeSessionToolServer(
  port: ProviderSessionToolPort,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: SESSION_TOOL_SERVER,
    tools: [
      tool(
        SESSION_TOOL_LIST,
        LIST_DESCRIPTION,
        { limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional() },
        args => runTool(() => port.listSessions({ limit: args.limit })),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        SESSION_TOOL_READ,
        READ_DESCRIPTION,
        {
          sessionId: z.string().min(1),
          beforeTurn: z.number().int().min(1).optional(),
        },
        args => runTool(() => port.readSession({
          sessionId: args.sessionId,
          beforeTurn: args.beforeTurn,
        })),
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}

// A throwing handler can break the whole turn, so port failures become tool errors.
async function runTool(
  call: () => Promise<ProviderSessionToolResult>,
): Promise<ToolCallResult> {
  try {
    const result = await call();
    return result.ok
      ? { content: [{ type: 'text', text: result.text }] }
      : { content: [{ type: 'text', text: result.message }], isError: true };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Session tool failed: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
}
