/**
 * Read-only access to Claudian conversations for the agent (`list_sessions`, `read_session`).
 *
 * The port is already bound to the calling conversation by the chat layer, so the
 * backend never learns conversation identity. Results are Markdown for the model,
 * not JSON: models tend to copy JSON tool output verbatim into their answers.
 */

export const SESSION_TOOL_SERVER = 'claudian';
export const SESSION_TOOL_LIST = 'list_sessions';
export const SESSION_TOOL_READ = 'read_session';
export const SESSION_TOOL_LIST_FULL_NAME = `mcp__${SESSION_TOOL_SERVER}__${SESSION_TOOL_LIST}`;
export const SESSION_TOOL_READ_FULL_NAME = `mcp__${SESSION_TOOL_SERVER}__${SESSION_TOOL_READ}`;

/** `ok: false` maps to an MCP tool result with `isError: true`; never thrown. */
export type ProviderSessionToolResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string };

export interface ProviderSessionListRequest {
  readonly limit?: number;
}

export interface ProviderSessionReadRequest {
  readonly sessionId: string;
  /** 1-based turn number; returns turns strictly before it. */
  readonly beforeTurn?: number;
}

export interface ProviderSessionToolPort {
  listSessions(request: ProviderSessionListRequest): Promise<ProviderSessionToolResult>;
  readSession(request: ProviderSessionReadRequest): Promise<ProviderSessionToolResult>;
}
