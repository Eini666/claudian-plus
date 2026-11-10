import { type ChatMessage, isCanonicalUserMessage } from '@/core/types';
import { extractUserDisplayContent } from '@/utils/context';

/** ~10k tokens per `read_session` call; older turns are paged with `beforeTurn`. */
export const SESSION_READ_CHAR_BUDGET = 40000;

const TRUNCATED_MARKER = '\n[…truncated]';

export interface SessionTurn {
  user: string;
  assistant: string;
}

export interface SessionTranscriptHeader {
  id: string;
  title: string;
  providerId: string;
  isArchived: boolean;
}

/**
 * Pairs each canonical user prompt with the final assistant text of its turn.
 *
 * A trailing turn is still running when its assistant text is empty. The caller's own
 * session is always mid-turn while the tool runs, but its message array may or may not
 * contain that turn yet, so there the trailing turn counts as running only while it has
 * no `durationSeconds` (set on completion by the live UI and by native history).
 */
export function extractSessionTurns(
  messages: readonly ChatMessage[],
  options: { isCaller: boolean },
): SessionTurn[] {
  const turns: { user: string; assistants: ChatMessage[] }[] = [];
  for (const message of messages) {
    if (isCanonicalUserMessage(message)) {
      const user = message.displayContent
        ?? extractUserDisplayContent(message.content)
        ?? message.content;
      turns.push({ user, assistants: [] });
    } else if (message.role === 'assistant' && turns.length > 0) {
      turns[turns.length - 1].assistants.push(message);
    }
  }

  const result = turns.map(turn => ({ user: turn.user.trim(), assistant: finalAssistantText(turn.assistants) }));
  const last = turns[turns.length - 1];
  if (last) {
    const lastAssistant = last.assistants[last.assistants.length - 1];
    const running = result[result.length - 1].assistant === ''
      || (options.isCaller && !lastAssistant?.durationSeconds);
    if (running) result.pop();
  }
  return result;
}

/** Text after the last tool/subagent block; falls back to all text when the turn ended on a tool. */
function finalAssistantText(assistants: readonly ChatMessage[]): string {
  const segments: { kind: 'text' | 'other'; text: string }[] = [];
  for (const message of assistants) {
    if (message.contentBlocks?.length) {
      for (const block of message.contentBlocks) {
        if (block.type === 'text') segments.push({ kind: 'text', text: block.content });
        else if (block.type === 'tool_use' || block.type === 'subagent') segments.push({ kind: 'other', text: '' });
      }
    } else if (message.content) {
      segments.push({ kind: 'text', text: message.content });
    }
  }
  const join = (list: typeof segments): string => list
    .filter(segment => segment.kind === 'text')
    .map(segment => segment.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const lastOther = segments.map(segment => segment.kind).lastIndexOf('other');
  return join(segments.slice(lastOther + 1)) || join(segments);
}

function renderTurn(turn: SessionTurn, turnNumber: number): string {
  return `### Turn ${turnNumber}\n\n**User:**\n${turn.user}\n\n**Assistant:**\n${turn.assistant}\n\n`;
}

/**
 * Newest turns that fit the budget, ending just before `beforeTurn` (1-based) when given.
 * A single turn larger than the budget is cut with a marker instead of being skipped.
 */
export function formatSessionTranscript(
  header: SessionTranscriptHeader,
  turns: readonly SessionTurn[],
  options: { beforeTurn?: number; charBudget?: number } = {},
): string {
  const budget = options.charBudget ?? SESSION_READ_CHAR_BUDGET;
  const totalTurns = turns.length;
  const end = options.beforeTurn === undefined
    ? totalTurns
    : Math.min(Math.max(options.beforeTurn - 1, 0), totalTurns);

  const blocks: string[] = [];
  let used = 0;
  let start = end;
  while (start > 0) {
    const block = renderTurn(turns[start - 1], start);
    if (used + block.length > budget) {
      if (blocks.length === 0) {
        // -1 leaves room for the final newline, so the turns section stays within budget.
        blocks.push(block.slice(0, budget - TRUNCATED_MARKER.length - 1) + TRUNCATED_MARKER);
        start -= 1;
      }
      break;
    }
    blocks.unshift(block);
    used += block.length;
    start -= 1;
  }

  const lines = [
    `# Session: ${header.title}`,
    '',
    `- id: ${header.id}`,
    `- provider: ${header.providerId}`,
    `- status: ${header.isArchived ? 'archived' : 'active'}`,
  ];
  if (blocks.length === 0) {
    lines.push(`- turns: none to show (totalTurns ${totalTurns})`);
    return `${lines.join('\n')}\n`;
  }
  const fromTurn = start + 1;
  lines.push(`- turns: fromTurn ${fromTurn} to toTurn ${end} of totalTurns ${totalTurns}`);
  if (fromTurn > 1) {
    lines.push(`- older turns exist: call read_session again with beforeTurn=${fromTurn}`);
  }
  return `${lines.join('\n')}\n\n${blocks.join('').trimEnd()}\n`;
}
