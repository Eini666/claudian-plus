import { createMockEl } from '@test/helpers/MockElement';

import type { ConversationMeta, ProjectRecord } from '@/core/types';
import {
  ConversationController,
  type ConversationControllerDeps,
} from '@/features/chat/controllers/ConversationController';
import type { ProjectListActions } from '@/features/chat/session-manager/ProjectSections';
import {
  CONVERSATION_DRAG_MIME,
  DROP_TARGET_CLASS,
  makeConversationDraggable,
  makeDropTarget,
} from '@/features/chat/session-manager/SessionDragDrop';
import { ChatState } from '@/features/chat/state/ChatState';

class MockDataTransfer {
  private readonly data = new Map<string, string>();
  effectAllowed = 'none';
  dropEffect = 'none';

  get types(): string[] {
    return [...this.data.keys()];
  }

  setData(type: string, value: string): void {
    this.data.set(type, value);
  }

  getData(type: string): string {
    return this.data.get(type) ?? '';
  }
}

function dragEvent(type: string, dataTransfer: MockDataTransfer) {
  return {
    type,
    dataTransfer,
    relatedTarget: null,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
}

function carrying(conversationId: string): MockDataTransfer {
  const dataTransfer = new MockDataTransfer();
  dataTransfer.setData(CONVERSATION_DRAG_MIME, conversationId);
  return dataTransfer;
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

function render(conversations: Partial<ConversationMeta>[], extra: Record<string, unknown> = {}) {
  const deps = {
    plugin: {
      getConversationList: jest.fn().mockReturnValue(conversations),
      getConversationSync: jest.fn().mockReturnValue(null),
      settings: {},
    },
    state: new ChatState(),
    getExecutionCoordinator: () => null,
  } as unknown as ConversationControllerDeps;
  const container = createMockEl();
  const projectActions = createActions();
  const onSetConversationPinned = jest.fn().mockResolvedValue(undefined);
  new ConversationController(deps).renderHistoryDropdown(container, {
    onSelectConversation: jest.fn(),
    onRerender: jest.fn(),
    showPinnedSection: true,
    sessionScope: 'active',
    sessionActionMode: 'active',
    sort: 'last-updated',
    projects: [projectA],
    projectActions,
    onSetConversationPinned,
    ...extra,
  });
  return { container, projectActions, onSetConversationPinned };
}

function projectHeader(container: any): any {
  return container.querySelector('.claudian-session-group-header--project');
}

function row(container: any, conversationId: string): any {
  return container.querySelectorAll('.claudian-history-item')
    .find((item: any) => item.getAttribute('data-conversation-id') === conversationId);
}

const conversations: Partial<ConversationMeta>[] = [
  { id: 'inA', title: 'In Alpha', createdAt: 1, lastActivityAt: 3, projectId: 'a' },
  { id: 'free', title: 'Free', createdAt: 1, lastActivityAt: 2 },
  { id: 'pin', title: 'Pinned', createdAt: 1, lastActivityAt: 1, isPinned: true },
];

describe('SessionDragDrop helpers', () => {
  it('dragstart stores the conversation id under the conversation MIME type', () => {
    const el = createMockEl();
    makeConversationDraggable(el, 'conv-1');
    const dataTransfer = new MockDataTransfer();

    el.dispatchEvent(dragEvent('dragstart', dataTransfer));

    expect(el.draggable).toBe(true);
    expect(dataTransfer.getData(CONVERSATION_DRAG_MIME)).toBe('conv-1');
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('ignores foreign drags such as files from the file explorer', () => {
    const el = createMockEl();
    const onDrop = jest.fn();
    makeDropTarget(el, onDrop);
    const files = new MockDataTransfer();
    files.setData('Files', '');

    const over = dragEvent('dragover', files);
    el.dispatchEvent(over);
    const drop = dragEvent('drop', files);
    el.dispatchEvent(drop);

    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(drop.preventDefault).not.toHaveBeenCalled();
    expect(el.hasClass(DROP_TARGET_CLASS)).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('highlights the target while a conversation hovers and clears it on leave and drop', () => {
    const el = createMockEl();
    const onDrop = jest.fn();
    makeDropTarget(el, onDrop);

    const over = dragEvent('dragover', carrying('conv-1'));
    el.dispatchEvent(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(el.hasClass(DROP_TARGET_CLASS)).toBe(true);

    el.dispatchEvent(dragEvent('dragleave', carrying('conv-1')));
    expect(el.hasClass(DROP_TARGET_CLASS)).toBe(false);

    el.dispatchEvent(dragEvent('dragenter', carrying('conv-1')));
    el.dispatchEvent(dragEvent('drop', carrying('conv-1')));
    expect(el.hasClass(DROP_TARGET_CLASS)).toBe(false);
    expect(onDrop).toHaveBeenCalledWith('conv-1');
  });
});

describe('Session list drop targets', () => {
  it('only rows of the active list are draggable', () => {
    expect(row(render(conversations).container, 'free').draggable).toBe(true);
    const archived = render(
      [{ id: 'old', title: 'Old', createdAt: 1, isArchived: true }],
      {
        sessionScope: 'archived',
        sessionActionMode: 'archived',
        showPinnedSection: false,
        showArchivedSection: true,
      },
    );
    expect(row(archived.container, 'old').draggable).toBeFalsy();
  });

  it('drop on a project row moves the conversation into that project', () => {
    const { container, projectActions } = render(conversations);

    projectHeader(container).dispatchEvent(dragEvent('drop', carrying('free')));

    expect(projectActions.moveToProject).toHaveBeenCalledWith('free', 'a');
  });

  it('drop on the project the conversation already belongs to does nothing', () => {
    const { container, projectActions } = render(conversations);

    projectHeader(container).dispatchEvent(dragEvent('drop', carrying('inA')));

    expect(projectActions.moveToProject).not.toHaveBeenCalled();
  });

  it('drop on the Sessions header removes the conversation from its project', () => {
    const { container, projectActions } = render(conversations);
    const sessionsHeader = container.querySelector('.claudian-session-list-header');

    sessionsHeader.dispatchEvent(dragEvent('drop', carrying('free')));
    expect(projectActions.moveToProject).not.toHaveBeenCalled();

    sessionsHeader.dispatchEvent(dragEvent('drop', carrying('inA')));
    expect(projectActions.moveToProject).toHaveBeenCalledWith('inA', null);
  });

  it('drop on the Pinned header pins the conversation', () => {
    const { container, onSetConversationPinned } = render(conversations);
    const pinnedHeader = container
      .querySelector('.claudian-history-section--pinned')
      .querySelector('.claudian-session-section-header');

    pinnedHeader.dispatchEvent(dragEvent('drop', carrying('pin')));
    expect(onSetConversationPinned).not.toHaveBeenCalled();

    pinnedHeader.dispatchEvent(dragEvent('drop', carrying('inA')));
    expect(onSetConversationPinned).toHaveBeenCalledWith('inA', true);
  });
});
