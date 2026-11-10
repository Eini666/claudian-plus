import { createMockEl } from '@test/helpers/MockElement';
import { Menu } from 'obsidian';

import type { ConversationMeta, ProjectRecord } from '@/core/types';
import {
  ConversationController,
  type ConversationControllerDeps,
} from '@/features/chat/controllers/ConversationController';
import type { ProjectListActions } from '@/features/chat/session-manager/ProjectSections';
import { ChatState } from '@/features/chat/state/ChatState';
import { t } from '@/i18n/i18n';

type MockMenu = { items: Array<{ title: string; clickHandler: (() => void) | null }> };

function lastMenu(): MockMenu {
  return (Menu as unknown as { instances: MockMenu[] }).instances.at(-1)!;
}

function createController(conversations: Partial<ConversationMeta>[]): ConversationController {
  const deps = {
    plugin: {
      getConversationList: jest.fn().mockReturnValue(conversations),
      getConversationSync: jest.fn().mockReturnValue(null),
      settings: {},
    },
    state: new ChatState(),
    getExecutionCoordinator: () => null,
  } as unknown as ConversationControllerDeps;
  return new ConversationController(deps);
}

function createActions(): jest.Mocked<ProjectListActions> {
  return {
    createProject: jest.fn().mockResolvedValue(null),
    startProjectConversation: jest.fn().mockResolvedValue(undefined),
    renameProject: jest.fn().mockResolvedValue(undefined),
    setProjectPinned: jest.fn().mockResolvedValue(undefined),
    archiveProject: jest.fn().mockResolvedValue(undefined),
    deleteProject: jest.fn().mockResolvedValue(undefined),
    chooseProjectFor: jest.fn().mockResolvedValue(undefined),
    moveToProject: jest.fn().mockResolvedValue(undefined),
  };
}

const projectA: ProjectRecord = { id: 'a', name: 'Alpha', createdAt: 1 };
const projectB: ProjectRecord = { id: 'b', name: 'Beta', createdAt: 2 };

function titles(el: any): string[] {
  return el.querySelectorAll('.claudian-history-item-title')
    .map((title: { textContent: string }) => title.textContent);
}

function render(
  conversations: Partial<ConversationMeta>[],
  projects: ProjectRecord[],
  extra: Record<string, unknown> = {},
) {
  const container = createMockEl();
  const projectActions = createActions();
  const onGroupCollapseChange = jest.fn();
  const onRerender = jest.fn();
  createController(conversations).renderHistoryDropdown(container, {
    onSelectConversation: jest.fn(),
    onRerender,
    showPinnedSection: true,
    sessionScope: 'active',
    sessionActionMode: 'active',
    sort: 'last-updated',
    projects,
    projectActions,
    onGroupCollapseChange,
    ...extra,
  });
  return { container, projectActions, onGroupCollapseChange, onRerender };
}

function projectHeader(container: any, projectId: string): any {
  return container.querySelectorAll('.claudian-session-group-header--project')
    .find((header: any) => header.getAttribute('data-project-id') === projectId);
}

describe('Project sections on the session list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as unknown as { instances: unknown[] }).instances.length = 0;
  });

  it('renders projects between Pinned and Sessions without duplicating their sessions', () => {
    const { container } = render([
      { id: 'a1', title: 'Alpha one', createdAt: 1, lastActivityAt: 5, projectId: 'a' },
      { id: 'b1', title: 'Beta one', createdAt: 1, lastActivityAt: 4, projectId: 'b' },
      { id: 'free', title: 'Free', createdAt: 1, lastActivityAt: 3 },
      { id: 'pin', title: 'Pinned', createdAt: 1, lastActivityAt: 2, isPinned: true },
    ], [projectA, projectB]);

    const list = container.querySelector('.claudian-history-list');
    const sectionClasses = list.children.map((child: any) => child.className);
    expect(sectionClasses).toEqual([
      'claudian-history-section claudian-history-section--pinned',
      'claudian-history-section claudian-history-section--projects',
      'claudian-history-section claudian-history-section--sessions',
    ]);
    const projects = container.querySelector('.claudian-history-section--projects');
    expect(projects.querySelector('.claudian-history-section-label').textContent)
      .toBe(t('chat.projects.section'));
    expect(projects.querySelectorAll('.claudian-session-group-label')
      .map((label: any) => label.textContent)).toEqual(['Alpha', 'Beta']);
    expect(titles(projects)).toEqual(['Alpha one', 'Beta one']);
    expect(titles(container.querySelector('.claudian-history-section--sessions'))).toEqual(['Free']);
    expect(projectHeader(container, 'a').querySelector('.claudian-session-group-count').textContent)
      .toBe('1');
  });

  it('keeps a collapsed project empty and toggles it through the collapse callback', () => {
    const { container, onGroupCollapseChange, onRerender } = render(
      [{ id: 'a1', title: 'Alpha one', createdAt: 1, lastActivityAt: 1, projectId: 'a' }],
      [projectA],
      { collapsedGroupKeys: new Set(['project:a']) },
    );

    expect(titles(container)).toEqual([]);
    const header = projectHeader(container, 'a');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    expect(onGroupCollapseChange).toHaveBeenCalledWith('project:a', false);
    expect(onRerender).toHaveBeenCalled();
  });

  it('shows a pinned project with its header inside Pinned, not in Projects', () => {
    const { container } = render(
      [{ id: 'a1', title: 'Alpha one', createdAt: 1, lastActivityAt: 1, projectId: 'a' }],
      [{ ...projectA, isPinned: true }, projectB],
    );

    const pinned = container.querySelector('.claudian-history-section--pinned');
    expect(projectHeader(pinned, 'a')).toBeDefined();
    expect(titles(pinned)).toEqual(['Alpha one']);
    const projects = container.querySelector('.claudian-history-section--projects');
    expect(projectHeader(projects, 'a')).toBeUndefined();
    expect(projectHeader(projects, 'b')).toBeDefined();
  });

  it('shows the empty-state text for a project without sessions', () => {
    const { container } = render([], [projectA]);

    expect(container.querySelector('.claudian-session-group-empty').textContent)
      .toBe(t('chat.projects.empty'));
  });

  it('keeps the New project button reachable with zero projects', () => {
    const { container, projectActions } = render(
      [{ id: 'free', title: 'Free', createdAt: 1, lastActivityAt: 1 }],
      [],
    );

    const button = container.querySelector('.claudian-project-new-btn');
    expect(button.getAttribute('aria-label')).toBe(t('chat.projects.new'));
    button.click();
    expect(projectActions.createProject).toHaveBeenCalledTimes(1);
  });

  it('starts a project session from the row + button', () => {
    const { container, projectActions } = render([], [projectA]);

    const plus = projectHeader(container, 'a').querySelectorAll('.claudian-session-group-new-action')[0];
    expect(plus.getAttribute('aria-label')).toBe(t('chat.projects.newSession'));
    plus.click();
    expect(projectActions.startProjectConversation).toHaveBeenCalledWith('a');
  });

  it('offers five project menu items and Unpin for a pinned project', () => {
    const { container, projectActions } = render([], [projectA, { ...projectB, isPinned: true }]);

    projectHeader(container, 'a').querySelector('.claudian-project-menu-action').click();
    expect(lastMenu().items.map(item => item.title)).toEqual([
      t('chat.projects.newSession'),
      t('chat.projects.pin'),
      t('chat.projects.rename'),
      t('chat.projects.archiveAll'),
      t('chat.projects.delete'),
    ]);
    lastMenu().items[3].clickHandler?.();
    expect(projectActions.archiveProject).toHaveBeenCalledWith('a');

    projectHeader(container, 'b').querySelector('.claudian-project-menu-action').click();
    expect(lastMenu().items[1].title).toBe(t('chat.projects.unpin'));
    lastMenu().items[1].clickHandler?.();
    expect(projectActions.setProjectPinned).toHaveBeenCalledWith('b', false);
  });

  it('shows a flat result list while searching', () => {
    const { container } = render(
      [{ id: 'a1', title: 'Alpha one', createdAt: 1, lastActivityAt: 1, projectId: 'a' }],
      [projectA],
      { searchQuery: 'alpha' },
    );

    expect(container.querySelector('.claudian-history-section--projects')).toBeNull();
    expect(titles(container.querySelector('.claudian-history-section--sessions'))).toEqual(['Alpha one']);
  });

  it('lets project membership win over Linked content grouping', () => {
    const { container } = render([
      {
        id: 'a1',
        title: 'Alpha note',
        createdAt: 1,
        lastActivityAt: 1,
        projectId: 'a',
        linkedContentPath: 'Notes/Plan.md',
      },
    ], [projectA], { organization: 'linked-content' });

    expect(titles(container.querySelector('.claudian-history-section--projects'))).toEqual(['Alpha note']);
    expect(titles(container.querySelector('.claudian-history-section--sessions'))).toEqual([]);
  });

  describe('conversation row menu', () => {
    function openRowMenu(container: any, conversationId: string): string[] {
      const item = container.querySelectorAll('.claudian-history-item')
        .find((el: any) => el.getAttribute('data-conversation-id') === conversationId);
      item.dispatchEvent({ type: 'contextmenu', preventDefault: jest.fn(), stopPropagation: jest.fn() });
      return lastMenu().items.map(menuItem => menuItem.title);
    }

    it('offers Remove from project only for a session in a live project', () => {
      const { container, projectActions } = render([
        { id: 'a1', title: 'Alpha one', createdAt: 1, lastActivityAt: 2, projectId: 'a' },
        { id: 'free', title: 'Free', createdAt: 1, lastActivityAt: 1 },
        { id: 'ghost', title: 'Ghost', createdAt: 1, lastActivityAt: 0, projectId: 'deleted' },
      ], [projectA]);

      expect(openRowMenu(container, 'a1')).toEqual(expect.arrayContaining([
        t('chat.projects.moveTo'),
        t('chat.projects.removeFrom'),
      ]));
      lastMenu().items.find(item => item.title === t('chat.projects.removeFrom'))?.clickHandler?.();
      expect(projectActions.moveToProject).toHaveBeenCalledWith('a1', null);

      const freeItems = openRowMenu(container, 'free');
      expect(freeItems).toContain(t('chat.projects.moveTo'));
      expect(freeItems).not.toContain(t('chat.projects.removeFrom'));
      lastMenu().items.find(item => item.title === t('chat.projects.moveTo'))?.clickHandler?.();
      expect(projectActions.chooseProjectFor).toHaveBeenCalledWith('free');

      expect(openRowMenu(container, 'ghost')).not.toContain(t('chat.projects.removeFrom'));
    });

    it('has no project items in the Archive view', () => {
      const { container } = render(
        [{ id: 'a1', title: 'Alpha one', createdAt: 1, lastActivityAt: 1, projectId: 'a', isArchived: true }],
        [projectA],
        {
          sessionScope: 'archived',
          sessionActionMode: 'archived',
          showPinnedSection: false,
          showArchivedSection: true,
        },
      );

      expect(container.querySelector('.claudian-history-section--projects')).toBeNull();
      const items = openRowMenu(container, 'a1');
      expect(items).not.toContain(t('chat.projects.moveTo'));
      expect(items).not.toContain(t('chat.projects.removeFrom'));
    });
  });
});
