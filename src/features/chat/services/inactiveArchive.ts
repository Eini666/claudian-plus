import type { ConversationMeta, SessionAutoArchiveAfter } from '../../../core/types';

const DAY_MS = 86_400_000;

const AFTER_DAYS: Record<SessionAutoArchiveAfter, number | null> = {
  off: null,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

type ArchiveCandidate = Pick<ConversationMeta, 'id' | 'isPinned' | 'isArchived' | 'lastActivityAt'>;

/**
 * Rozmowy do automatycznej archiwizacji (upstream #1494): nieprzypiete, niearchiwalne,
 * nieruszane dluzej niz prog i nieotwarte w zadnej karcie. Archiwizacja jest odwracalna.
 */
export function isInactiveArchiveCandidate(
  conversation: ArchiveCandidate,
  after: SessionAutoArchiveAfter | undefined,
  isOpen: (id: string) => boolean,
  nowMs: number,
): boolean {
  const days = AFTER_DAYS[after ?? 'off'] ?? null;
  if (days === null) return false;
  return !conversation.isPinned
    && !conversation.isArchived
    && conversation.lastActivityAt < nowMs - days * DAY_MS
    && !isOpen(conversation.id);
}
