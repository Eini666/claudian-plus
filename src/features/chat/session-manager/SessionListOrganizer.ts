import type {
  ConversationMeta,
  ProjectRecord,
  SessionManagerOrganization,
  SessionManagerSort,
} from '../../../core/types';
import { isProvisionalNotePath } from './ProvisionalNoteNames';

export { isProvisionalNotePath } from './ProvisionalNoteNames';

export type SessionListSectionKind = 'list' | 'content' | 'ungrouped' | 'missing' | 'project';

export interface SessionListSection {
  key: string;
  kind: SessionListSectionKind;
  label?: string;
  contentPath?: string;
  projectId?: string;
  conversations: ConversationMeta[];
}

export interface ProjectGrouping {
  pinnedProjects: SessionListSection[];
  projects: SessionListSection[];
  /** Conversations without a live project, plus individually pinned ones (Pinned renders them). */
  rest: ConversationMeta[];
}

interface OrganizeSessionListOptions {
  organization: SessionManagerOrganization;
  sort: SessionManagerSort;
  language: string;
  includeContentPaths?: readonly string[];
  contentExists?: (contentPath: string) => boolean;
  contentIsNote?: (contentPath: string) => boolean;
}

export function isLegacyProvisionalLinkedContent(
  contentPath: string,
  options: Pick<OrganizeSessionListOptions, 'contentExists' | 'contentIsNote' | 'language'>,
): boolean {
  if (!isProvisionalNotePath(contentPath, options.language)) return false;
  if (options.contentExists?.(contentPath) === false) return false;
  return options.contentIsNote?.(contentPath) !== false;
}

function getLastActivityTimestamp(conversation: ConversationMeta): number {
  return conversation.lastActivityAt;
}

function compareConversations(
  left: ConversationMeta,
  right: ConversationMeta,
  sort: SessionManagerSort,
): number {
  const getTimestamp = sort === 'created'
    ? (conversation: ConversationMeta) => conversation.createdAt
    : getLastActivityTimestamp;
  const leftTimestamp = getTimestamp(left);
  const rightTimestamp = getTimestamp(right);
  return rightTimestamp - leftTimestamp
    || left.title.localeCompare(right.title, undefined, { sensitivity: 'base', numeric: true })
    || left.id.localeCompare(right.id);
}

function getSectionTimestamp(
  section: SessionListSection,
  sort: SessionManagerSort,
): number {
  return section.conversations.reduce((latest, conversation) => {
    const timestamp = sort === 'created'
      ? conversation.createdAt
      : getLastActivityTimestamp(conversation);
    return Math.max(latest, timestamp);
  }, 0);
}

function compareSections(
  left: SessionListSection,
  right: SessionListSection,
  sort: SessionManagerSort,
): number {
  return getSectionTimestamp(right, sort) - getSectionTimestamp(left, sort)
    || (left.label ?? '').localeCompare(right.label ?? '', undefined, {
      sensitivity: 'base',
      numeric: true,
    });
}

export function getLinkedContentTitle(contentPath: string): string {
  const filename = contentPath.replace(/\\/g, '/').split('/').pop() ?? contentPath;
  return filename.replace(/\.md$/i, '');
}

export function organizeSessionList(
  conversations: readonly ConversationMeta[],
  options: OrganizeSessionListOptions,
): SessionListSection[] {
  const sortedConversations = [...conversations].sort((left, right) => (
    compareConversations(left, right, options.sort)
  ));
  if (options.organization === 'list') {
    return [{
      key: 'list',
      kind: 'list',
      conversations: sortedConversations,
    }];
  }

  const contentGroups = new Map<string, SessionListSection>();
  for (const contentPath of options.includeContentPaths ?? []) {
    const kind: SessionListSectionKind = options.contentExists?.(contentPath) === false
      ? 'missing'
      : 'content';
    contentGroups.set(contentPath, {
      key: `${kind}:${contentPath}`,
      kind,
      label: getLinkedContentTitle(contentPath),
      contentPath,
      conversations: [],
    });
  }
  const ungrouped: ConversationMeta[] = [];
  for (const conversation of sortedConversations) {
    const contentPath = conversation.linkedContentPath;
    if (!contentPath || isLegacyProvisionalLinkedContent(contentPath, options)) {
      ungrouped.push(conversation);
      continue;
    }

    const kind: SessionListSectionKind = options.contentExists?.(contentPath) === false
      ? 'missing'
      : 'content';
    let group = contentGroups.get(contentPath);
    if (!group) {
      group = {
        key: `${kind}:${contentPath}`,
        kind,
        label: getLinkedContentTitle(contentPath),
        contentPath,
        conversations: [],
      };
      contentGroups.set(contentPath, group);
    }
    group.conversations.push(conversation);
  }

  const sections = [...contentGroups.values()];
  if (ungrouped.length > 0) {
    sections.push({
      key: 'ungrouped',
      kind: 'ungrouped',
      label: 'Unlinked',
      conversations: ungrouped,
    });
  }
  return sections.sort((left, right) => (
    compareSections(left, right, options.sort)
  ));
}

/**
 * Splits conversations into project sections. Membership resolves only through a live project;
 * an individually pinned conversation stays in `rest` so the Pinned section shows it on its own.
 */
export function groupConversationsByProject(
  conversations: readonly ConversationMeta[],
  projects: readonly ProjectRecord[],
  sort: SessionManagerSort,
): ProjectGrouping {
  const sections = new Map<string, SessionListSection>();
  for (const project of projects) {
    sections.set(project.id, {
      key: `project:${project.id}`,
      kind: 'project',
      label: project.name,
      projectId: project.id,
      conversations: [],
    });
  }

  const rest: ConversationMeta[] = [];
  const sortedConversations = [...conversations].sort((left, right) => (
    compareConversations(left, right, sort)
  ));
  for (const conversation of sortedConversations) {
    const section = conversation.projectId && !conversation.isPinned
      ? sections.get(conversation.projectId)
      : undefined;
    if (section) {
      section.conversations.push(conversation);
    } else {
      rest.push(conversation);
    }
  }

  const createdAtById = new Map(projects.map(project => [project.id, project.createdAt]));
  const getProjectTimestamp = (section: SessionListSection) => (
    section.conversations.length > 0
      ? getSectionTimestamp(section, sort)
      : createdAtById.get(section.projectId ?? '') ?? 0
  );
  const sortedSections = [...sections.values()].sort((left, right) => (
    getProjectTimestamp(right) - getProjectTimestamp(left)
    || (left.label ?? '').localeCompare(right.label ?? '', undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  ));
  const pinnedIds = new Set(projects.filter(project => project.isPinned).map(project => project.id));
  return {
    pinnedProjects: sortedSections.filter(section => pinnedIds.has(section.projectId ?? '')),
    projects: sortedSections.filter(section => !pinnedIds.has(section.projectId ?? '')),
    rest,
  };
}
