import type { ConversationMeta, ProjectRecord } from '@/core/types';
import {
  groupConversationsByProject,
  isProvisionalNotePath,
  organizeSessionList,
} from '@/features/chat/session-manager/SessionListOrganizer';

function createConversation(
  id: string,
  overrides: Partial<ConversationMeta> = {},
): ConversationMeta {
  return {
    id,
    providerId: 'claude',
    title: id,
    createdAt: 1,
    lastActivityAt: 1,
    messageCount: 0,
    preview: '',
    ...overrides,
  };
}

describe('SessionListOrganizer', () => {
  it.each([
    ['Untitled.md', 'en'],
    ['Untitled 1.md', 'en'],
    ['Untitled 42.md', 'en'],
    ['未命名.md', 'zh'],
    ['未命名 2.md', 'zh-TW'],
    ['Notes/Sans titre 3.md', 'fr'],
  ])('recognizes the localized provisional note path %s', (path, language) => {
    expect(isProvisionalNotePath(path, language)).toBe(true);
  });

  it.each([
    ['Untitled project.md', 'en'],
    ['Untitled-1.md', 'en'],
    ['未命名项目.md', 'zh'],
    ['Sans titre final.md', 'fr'],
  ])('does not overmatch the ordinary note path %s', (path, language) => {
    expect(isProvisionalNotePath(path, language)).toBe(false);
  });

  it('groups by full note path and keeps same-name notes in separate groups', () => {
    const sections = organizeSessionList([
      createConversation('a', { linkedContentPath: 'Projects/A/Plan.md', lastActivityAt: 10 }),
      createConversation('b', { linkedContentPath: 'Projects/B/Plan.md', lastActivityAt: 30 }),
      createConversation('c', { linkedContentPath: 'Projects/A/Plan.md', lastActivityAt: 20 }),
    ], {
      organization: 'linked-content',
      sort: 'last-updated',
      language: 'en',
      contentExists: () => true,
    });

    expect(sections.map(section => section.contentPath)).toEqual([
      'Projects/B/Plan.md',
      'Projects/A/Plan.md',
    ]);
    expect(sections.map(section => section.label)).toEqual(['Plan', 'Plan']);
    expect(sections[1].conversations.map(conversation => conversation.id)).toEqual(['c', 'a']);
  });

  it('keeps unlinked and provisional sessions out of content groups', () => {
    const sections = organizeSessionList([
      createConversation('unlinked', { lastActivityAt: 20 }),
      createConversation('provisional', {
        linkedContentPath: 'Inbox/Untitled 2.md',
        lastActivityAt: 30,
      }),
      createConversation('linked', {
        linkedContentPath: 'Notes/Real note.md',
        lastActivityAt: 10,
      }),
    ], {
      organization: 'linked-content',
      sort: 'last-updated',
      language: 'en',
      contentExists: () => true,
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ kind: 'ungrouped', label: 'Unlinked' });
    expect(sections[0].conversations.map(conversation => conversation.id)).toEqual([
      'provisional',
      'unlinked',
    ]);
    expect(sections[1]).toMatchObject({ kind: 'content', contentPath: 'Notes/Real note.md' });
  });

  it('does not suppress existing folders or non-Note files with provisional names', () => {
    const sections = organizeSessionList([
      createConversation('folder', {
        linkedContentPath: 'Projects/Untitled',
        lastActivityAt: 20,
      }),
      createConversation('file', {
        linkedContentPath: 'Assets/Untitled',
        lastActivityAt: 10,
      }),
    ], {
      organization: 'linked-content',
      sort: 'last-updated',
      language: 'en',
      contentExists: () => true,
      contentIsNote: () => false,
    });

    expect(sections.map(section => section.contentPath)).toEqual([
      'Projects/Untitled',
      'Assets/Untitled',
    ]);
    expect(sections.flatMap(section => section.conversations).map(({ id }) => id))
      .toEqual(['folder', 'file']);
  });

  it('retains missing note paths as distinct missing groups', () => {
    const sections = organizeSessionList([
      createConversation('missing-a', { linkedContentPath: 'Gone/A.md' }),
      createConversation('missing-b', { linkedContentPath: 'Gone/B.md' }),
      createConversation('missing-untitled', { linkedContentPath: 'Gone/Untitled.md' }),
    ], {
      organization: 'linked-content',
      sort: 'created',
      language: 'en',
      contentExists: () => false,
    });

    expect(sections.map(section => ({
      kind: section.kind,
      label: section.label,
      contentPath: section.contentPath,
    }))).toEqual([
      { kind: 'missing', label: 'A', contentPath: 'Gone/A.md' },
      { kind: 'missing', label: 'B', contentPath: 'Gone/B.md' },
      { kind: 'missing', label: 'Untitled', contentPath: 'Gone/Untitled.md' },
    ]);
  });

  it('includes requested linked-content groups even when they have no sessions', () => {
    const sections = organizeSessionList([], {
      organization: 'linked-content',
      sort: 'last-updated',
      language: 'en',
      includeContentPaths: ['Projects/Plan.md'],
      contentExists: () => true,
    });

    expect(sections).toEqual([{
      conversations: [],
      key: 'content:Projects/Plan.md',
      kind: 'content',
      label: 'Plan',
      contentPath: 'Projects/Plan.md',
    }]);
  });

  it('returns one flat section for the chronological organization', () => {
    const sections = organizeSessionList([
      createConversation('older', { lastActivityAt: 10 }),
      createConversation('newer', { lastActivityAt: 20 }),
    ], {
      organization: 'list',
      sort: 'last-updated',
      language: 'en',
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe('list');
    expect(sections[0].conversations.map(conversation => conversation.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('uses lastActivityAt for the last-updated sort', () => {
    const sections = organizeSessionList([
      createConversation('older-update', {
        lastActivityAt: 10,
      }),
      createConversation('newer-update', {
        lastActivityAt: 20,
      }),
    ], {
      organization: 'list',
      sort: 'last-updated',
      language: 'en',
    });

    expect(sections[0].conversations.map(conversation => conversation.id)).toEqual([
      'newer-update',
      'older-update',
    ]);
  });
});

describe('groupConversationsByProject', () => {
  const alpha: ProjectRecord = { id: 'alpha', name: 'Alpha', createdAt: 5 };
  const beta: ProjectRecord = { id: 'beta', name: 'Beta', createdAt: 6 };
  const ids = (conversations: ConversationMeta[]) => conversations.map(item => item.id);

  it('builds one section per project and leaves the rest ungrouped', () => {
    const result = groupConversationsByProject([
      createConversation('a1', { projectId: 'alpha', lastActivityAt: 10 }),
      createConversation('b1', { projectId: 'beta', lastActivityAt: 20 }),
      createConversation('a2', { projectId: 'alpha', lastActivityAt: 30 }),
      createConversation('free', { lastActivityAt: 40 }),
    ], [alpha, beta], 'last-updated');

    expect(result.pinnedProjects).toEqual([]);
    expect(result.projects).toEqual([
      { key: 'project:alpha', kind: 'project', label: 'Alpha', projectId: 'alpha', conversations: expect.any(Array) },
      { key: 'project:beta', kind: 'project', label: 'Beta', projectId: 'beta', conversations: expect.any(Array) },
    ]);
    expect(ids(result.projects[0].conversations)).toEqual(['a2', 'a1']);
    expect(ids(result.projects[1].conversations)).toEqual(['b1']);
    expect(ids(result.rest)).toEqual(['free']);
  });

  it('treats a conversation with a missing project as having no project', () => {
    const result = groupConversationsByProject([
      createConversation('orphan', { projectId: 'deleted' }),
    ], [alpha], 'last-updated');

    expect(ids(result.rest)).toEqual(['orphan']);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].conversations).toEqual([]);
  });

  it('keeps an empty project as a section with no conversations', () => {
    const result = groupConversationsByProject([], [alpha], 'last-updated');

    expect(result.projects).toEqual([
      { key: 'project:alpha', kind: 'project', label: 'Alpha', projectId: 'alpha', conversations: [] },
    ]);
    expect(result.rest).toEqual([]);
  });

  it('moves a pinned project to pinnedProjects only', () => {
    const result = groupConversationsByProject([
      createConversation('a1', { projectId: 'alpha' }),
    ], [{ ...alpha, isPinned: true }, beta], 'last-updated');

    expect(result.pinnedProjects.map(section => section.projectId)).toEqual(['alpha']);
    expect(ids(result.pinnedProjects[0].conversations)).toEqual(['a1']);
    expect(result.projects.map(section => section.projectId)).toEqual(['beta']);
  });

  it('leaves an individually pinned conversation out of its project section', () => {
    const result = groupConversationsByProject([
      createConversation('pinned', { projectId: 'alpha', isPinned: true }),
      createConversation('member', { projectId: 'alpha' }),
    ], [alpha], 'last-updated');

    expect(ids(result.projects[0].conversations)).toEqual(['member']);
    expect(ids(result.rest)).toEqual(['pinned']);
  });

  it('orders conversations and projects by the selected sort', () => {
    const conversations = [
      createConversation('a-old-active', { projectId: 'alpha', createdAt: 1, lastActivityAt: 100 }),
      createConversation('a-new-idle', { projectId: 'alpha', createdAt: 50, lastActivityAt: 60 }),
      createConversation('b-mid', { projectId: 'beta', createdAt: 70, lastActivityAt: 70 }),
    ];
    const empty: ProjectRecord = { id: 'empty', name: 'Empty', createdAt: 80 };

    const byActivity = groupConversationsByProject(conversations, [alpha, beta, empty], 'last-updated');
    expect(byActivity.projects.map(section => section.projectId)).toEqual(['alpha', 'empty', 'beta']);
    expect(ids(byActivity.projects[0].conversations)).toEqual(['a-old-active', 'a-new-idle']);

    const byCreated = groupConversationsByProject(conversations, [alpha, beta, empty], 'created');
    expect(byCreated.projects.map(section => section.projectId)).toEqual(['empty', 'beta', 'alpha']);
    expect(ids(byCreated.projects[2].conversations)).toEqual(['a-new-idle', 'a-old-active']);
  });
});
