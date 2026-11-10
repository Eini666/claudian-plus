import { SESSION_TOOL_LIST_FULL_NAME, SESSION_TOOL_READ_FULL_NAME } from '@/core/execution';

export type SessionTitleResolver = (sessionId: string) => string | undefined;

let resolveTitle: SessionTitleResolver = () => undefined;

/** Card titles follow the live conversation list, so old results show the current title. */
export function setSessionTitleResolver(resolver: SessionTitleResolver): void {
  resolveTitle = resolver;
}

export function isSessionTool(name: string): boolean {
  return name === SESSION_TOOL_LIST_FULL_NAME || name === SESSION_TOOL_READ_FULL_NAME;
}

export function getSessionToolName(name: string, input: Record<string, unknown>): string | null {
  if (name === SESSION_TOOL_LIST_FULL_NAME) return 'Lista rozmów';
  if (name !== SESSION_TOOL_READ_FULL_NAME) return null;
  const id = typeof input.sessionId === 'string' ? input.sessionId : '';
  if (!id) return 'Czytam rozmowę';
  return `Czytam rozmowę „${resolveTitle(id) ?? id}”`;
}

export function getSessionToolSummary(name: string, result: string | undefined): string | null {
  if (!result) return null;
  if (name === SESSION_TOOL_LIST_FULL_NAME) return conversationsLabel(listedTitles(result).length);
  if (name !== SESSION_TOOL_READ_FULL_NAME) return null;
  const range = /^- turns: fromTurn (\d+) to toTurn (\d+) of totalTurns (\d+)$/m.exec(result);
  return range ? `tury ${range[1]}–${range[2]} z ${range[3]}` : null;
}

/** The transcript stays with the agent: the card shows only the summary line or listed titles. */
export function renderSessionToolResult(container: HTMLElement, name: string, result: string): void {
  const lines = name === SESSION_TOOL_LIST_FULL_NAME
    ? listedTitles(result)
    : [getSessionToolSummary(name, result) ?? ''];
  const visible = lines.filter(Boolean);
  if (visible.length === 0) {
    container.createDiv({ cls: 'claudian-tool-empty', text: 'No result' });
    return;
  }
  const linesEl = container.createDiv({ cls: 'claudian-tool-lines' });
  for (const line of visible) {
    linesEl.createDiv({ cls: 'claudian-tool-line', text: line });
  }
}

function listedTitles(result: string): string[] {
  return result.split('\n')
    .filter(line => line.startsWith('- ') && !line.startsWith('- …truncated'))
    .map(line => /— "(.*)" — last activity/.exec(line)?.[1] ?? line.slice(2));
}

function conversationsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = count === 1
    ? 'rozmowa'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'rozmowy' : 'rozmów';
  return `${count} ${word}`;
}
