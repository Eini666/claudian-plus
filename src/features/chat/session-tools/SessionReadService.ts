import type {
  ProviderSessionListRequest,
  ProviderSessionReadRequest,
  ProviderSessionToolPort,
  ProviderSessionToolResult,
} from '@/core/execution';
import type { Conversation, ConversationMeta } from '@/core/types';

import { extractSessionTurns, formatSessionTranscript } from './formatSessionTranscript';

export const SESSION_LIST_DEFAULT_LIMIT = 50;
export const SESSION_LIST_MAX_LIMIT = 200;

/** The slice of the application conversation repository this service reads. */
export interface SessionReadRepository {
  list(): ConversationMeta[];
  getSync(id: string): Conversation | null;
  ensureHydrated(id: string): Promise<Conversation | null>;
}

export class SessionReadService {
  constructor(private readonly repository: SessionReadRepository) {}

  /** Binds caller identity here so the provider backend never sees it. */
  bindCaller(conversationId: string | null): ProviderSessionToolPort {
    return {
      listSessions: request => this.listSessions(conversationId, request),
      readSession: request => this.readSession(conversationId, request),
    };
  }

  private async listSessions(
    callerId: string | null,
    request: ProviderSessionListRequest,
  ): Promise<ProviderSessionToolResult> {
    try {
      const limit = clampLimit(request.limit);
      const sessions = this.repository.list()
        .filter(meta => !meta.isArchived)
        .sort((left, right) => activityOf(right) - activityOf(left));
      const shown = sessions.slice(0, limit);
      if (shown.length === 0) {
        return { ok: true, text: 'No sessions.' };
      }

      const lines = shown.map(meta => {
        const marker = meta.id === callerId ? ' (this session)' : '';
        const when = new Date(activityOf(meta)).toISOString();
        return `- ${meta.id}${marker} — "${meta.title}" — last activity ${when} — ${meta.messageCount} messages`;
      });
      if (sessions.length > shown.length) {
        lines.push(
          `- …truncated: showing ${shown.length} of ${sessions.length} sessions`
            + ` (limit max ${SESSION_LIST_MAX_LIMIT})`,
        );
      }
      return { ok: true, text: `${lines.join('\n')}\n` };
    } catch (error) {
      return { ok: false, message: `Could not list sessions: ${errorText(error)}` };
    }
  }

  private async readSession(
    callerId: string | null,
    request: ProviderSessionReadRequest,
  ): Promise<ProviderSessionToolResult> {
    const { sessionId, beforeTurn } = request;
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      return { ok: false, message: 'sessionId is required.' };
    }
    if (beforeTurn !== undefined && (!Number.isInteger(beforeTurn) || beforeTurn < 1)) {
      return { ok: false, message: 'beforeTurn must be an integer >= 1.' };
    }
    // Archived sessions stay readable by id; only list_sessions hides them.
    if (!this.repository.getSync(sessionId)) {
      return { ok: false, message: `No session with id ${sessionId}.` };
    }

    try {
      const conversation = await this.repository.ensureHydrated(sessionId);
      if (!conversation) {
        return { ok: false, message: `No session with id ${sessionId}.` };
      }
      const turns = extractSessionTurns(conversation.messages, { isCaller: sessionId === callerId });
      const text = formatSessionTranscript(
        {
          id: conversation.id,
          title: conversation.title,
          providerId: conversation.providerId,
          isArchived: conversation.isArchived === true,
        },
        turns,
        { beforeTurn },
      );
      return { ok: true, text };
    } catch (error) {
      return { ok: false, message: `Could not read session ${sessionId}: ${errorText(error)}` };
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SESSION_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), SESSION_LIST_MAX_LIMIT);
}

function activityOf(meta: ConversationMeta): number {
  return meta.lastActivityAt || meta.createdAt;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
