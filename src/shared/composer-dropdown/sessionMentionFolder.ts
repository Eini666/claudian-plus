import { t } from '@/i18n/i18n';

import type {
  ComposerDropdownFolderItem,
  ComposerDropdownItem,
  ComposerDropdownValueItem,
} from './types';

export const SESSION_MENTION_ROOT_LIMIT = 8;

/** Rozmowa do wskazania przez `@` — dostawca danych pomija biezaca i zarchiwizowane. */
export interface SessionMentionEntry {
  readonly id: string;
  readonly lastActivityAt: number;
  readonly title: string;
}

/** Rozmowy do pickera: bez biezacej rozmowy karty i bez zarchiwizowanych. */
export function selectMentionableSessions(
  conversations: readonly (SessionMentionEntry & { readonly isArchived?: boolean })[],
  currentConversationId: string | null,
): SessionMentionEntry[] {
  return conversations
    .filter(conversation => !conversation.isArchived && conversation.id !== currentConversationId)
    .map(({ id, title, lastActivityAt }) => ({ id, lastActivityAt, title }));
}

export interface SessionMentionValue extends SessionMentionEntry {
  readonly kind: 'session';
  /** Tekst wzmianki w kompozytorze, bez spacji konczacej (`@[Tytul]`). */
  readonly token: string;
}

/** Format daty jak na liscie sesji: dzis godzina, wczesniej dzien i miesiac. */
function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toItems(
  sessions: readonly SessionMentionEntry[],
  query: string,
  limit = Infinity,
): ComposerDropdownValueItem[] {
  const titleCounts = new Map<string, number>();
  for (const session of sessions) {
    titleCounts.set(session.title, (titleCounts.get(session.title) ?? 0) + 1);
  }
  const needle = query.toLocaleLowerCase();
  return [...sessions]
    .filter(session => session.title.toLocaleLowerCase().includes(needle))
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, limit)
    .map(session => {
      const token = (titleCounts.get(session.title) ?? 0) > 1
        ? `@[${session.title} · ${session.id.slice(0, 4)}]`
        : `@[${session.title}]`;
      return {
        className: 'is-session',
        detail: t('chat.sessionMention.detail', { date: formatSessionDate(session.lastActivityAt) }),
        icon: 'messages-square',
        id: `session:${session.id}`,
        kind: 'value',
        label: session.title,
        replacement: `${token} `,
        value: { ...session, kind: 'session', token } satisfies SessionMentionValue,
      };
    });
}

/**
 * Pozycje rozmow na glownym poziomie pickera albo zawartosc folderu „Sesje”,
 * gdy zapytanie zaczyna sie od jego prefiksu. `null` = zapytanie nie dotyczy folderu.
 */
export function loadSessionFolderQuery(
  getSessions: () => readonly SessionMentionEntry[],
  query: string,
): readonly ComposerDropdownItem[] | null {
  const prefix = `${t('chat.sessionMention.folder').toLocaleLowerCase()}/`;
  if (!query.toLocaleLowerCase().startsWith(prefix)) return null;
  return toItems(getSessions(), query.slice(prefix.length));
}

export function sessionRootItems(
  getSessions: () => readonly SessionMentionEntry[],
  query: string,
): ComposerDropdownItem[] {
  const sessions = getSessions();
  if (sessions.length === 0) return [];
  const label = t('chat.sessionMention.folder');
  const needle = query.toLocaleLowerCase();
  const items: ComposerDropdownItem[] = [];
  if (label.toLocaleLowerCase().includes(needle)) {
    items.push({
      className: 'is-session-folder',
      icon: 'messages-square',
      id: 'sessions',
      inputPrefix: `${label}/`,
      kind: 'folder',
      label,
      load: folderQuery => toItems(getSessions(), folderQuery),
    } satisfies ComposerDropdownFolderItem);
  }
  if (needle.length >= 2) items.push(...toItems(sessions, needle, SESSION_MENTION_ROOT_LIMIT));
  return items;
}
