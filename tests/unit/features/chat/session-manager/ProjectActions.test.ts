import { createMockEl } from '@test/helpers/MockElement';

import type { ConversationMeta, ProjectRecord } from '@/core/types';
import {
  ConversationController,
  type ConversationControllerDeps,
} from '@/features/chat/controllers/ConversationController';
import { ProjectActions, type ProjectActionsDeps } from '@/features/chat/session-manager/ProjectActions';
import { ChatState } from '@/features/chat/state/ChatState';
import { t } from '@/i18n/i18n';

function createDeps(
  projects: ProjectRecord[],
  conversations: Partial<ConversationMeta>[] = [],
): jest.Mocked<Omit<ProjectActionsDeps, 'host'>> & { host: jest.Mocked<ProjectActionsDeps['host']> } {
  return {
    host: {
      getProjects: jest.fn().mockReturnValue(projects),
      getConversationList: jest.fn().mockReturnValue(conversations),
      createProject: jest.fn(async (name: string) => ({ id: 'new', name, createdAt: 9 })),
      renameProject: jest.fn().mockResolvedValue(undefined),
      setProjectPinned: jest.fn().mockResolvedValue(undefined),
      deleteProject: jest.fn().mockResolvedValue(undefined),
      setConversationProject: jest.fn().mockResolvedValue(undefined),
    },
    isConversationRunning: jest.fn().mockReturnValue(false),
    archiveConversations: jest.fn().mockResolvedValue(undefined),
    openDraft: jest.fn(),
    promptName: jest.fn().mockResolvedValue(null),
    pickProject: jest.fn().mockResolvedValue(null),
    confirm: jest.fn().mockResolvedValue(true),
    notify: jest.fn(),
  };
}

const project: ProjectRecord = { id: 'p1', name: 'Claudian', createdAt: 1 };

describe('ProjectActions', () => {
  it('archives the project sessions, skips running ones and reports the counts', async () => {
    const deps = createDeps([project], [
      { id: 'idle', projectId: 'p1' },
      { id: 'busy', projectId: 'p1' },
      { id: 'pinned', projectId: 'p1', isPinned: true },
      { id: 'already', projectId: 'p1', isArchived: true },
      { id: 'other', projectId: 'p2' },
    ]);
    deps.isConversationRunning.mockImplementation(id => id === 'busy');

    await new ProjectActions(deps).archiveProject('p1');

    expect(deps.archiveConversations).toHaveBeenCalledWith(['idle']);
    expect(deps.notify).toHaveBeenCalledWith(t('chat.projects.archived', { count: 1, skipped: 1 }));
    expect(deps.host.deleteProject).not.toHaveBeenCalled();
  });

  it('starts a draft that carries the project id', async () => {
    const deps = createDeps([project]);
    const draft = { state: { draftProjectId: null as string | null } };
    deps.openDraft.mockResolvedValue(draft);

    await new ProjectActions(deps).startProjectConversation('p1');

    expect(draft.state.draftProjectId).toBe('p1');
  });

  it('refuses to start a draft for a project that no longer exists', async () => {
    const deps = createDeps([]);

    await expect(new ProjectActions(deps).startProjectConversation('gone')).rejects.toThrow();
    expect(deps.openDraft).not.toHaveBeenCalled();
  });

  it('deletes a project only after confirmation', async () => {
    const deps = createDeps([project]);
    deps.confirm.mockResolvedValueOnce(false);
    const actions = new ProjectActions(deps);

    await actions.deleteProject('p1');
    expect(deps.confirm).toHaveBeenCalledWith(t('chat.projects.deleteConfirm', { name: 'Claudian' }));
    expect(deps.host.deleteProject).not.toHaveBeenCalled();

    await actions.deleteProject('p1');
    expect(deps.host.deleteProject).toHaveBeenCalledWith('p1');
  });

  it('creates a project from the entered name and ignores a cancelled prompt', async () => {
    const deps = createDeps([]);
    const actions = new ProjectActions(deps);

    await expect(actions.createProject()).resolves.toBeNull();
    expect(deps.host.createProject).not.toHaveBeenCalled();

    deps.promptName.mockResolvedValueOnce('JARVIS');
    await expect(actions.createProject()).resolves.toEqual(expect.objectContaining({ name: 'JARVIS' }));
  });

  it('renames with the current name prefilled', async () => {
    const deps = createDeps([project]);
    deps.promptName.mockResolvedValueOnce('Claudian Plus');

    await new ProjectActions(deps).renameProject('p1');

    expect(deps.promptName).toHaveBeenCalledWith('Claudian');
    expect(deps.host.renameProject).toHaveBeenCalledWith('p1', 'Claudian Plus');
  });

  it('moves a session to a picked project or to a newly created one', async () => {
    const deps = createDeps([project]);
    const actions = new ProjectActions(deps);

    deps.pickProject.mockResolvedValueOnce({ kind: 'project', projectId: 'p1' });
    await actions.chooseProjectFor('c1');
    expect(deps.host.setConversationProject).toHaveBeenLastCalledWith('c1', 'p1');

    deps.pickProject.mockResolvedValueOnce({ kind: 'new' });
    deps.promptName.mockResolvedValueOnce('Fresh');
    await actions.chooseProjectFor('c2');
    expect(deps.host.setConversationProject).toHaveBeenLastCalledWith('c2', 'new');

    deps.pickProject.mockResolvedValueOnce(null);
    await actions.chooseProjectFor('c3');
    expect(deps.host.setConversationProject).toHaveBeenCalledTimes(2);
  });
});

describe('R9: only the project + starts a project session', () => {
  it('a new tab state has no draft project', () => {
    expect(new ChatState().draftProjectId).toBeNull();
  });

  it('New conversation in an existing tab clears the draft project', async () => {
    const state = new ChatState();
    state.draftProjectId = 'p1';
    const deps = {
      plugin: { settings: {}, getConversationList: jest.fn().mockReturnValue([]) },
      state,
      subagentManager: { orphanAllActive: jest.fn(), clear: jest.fn() },
      getMessagesEl: () => createMockEl(),
      setWelcomeEl: jest.fn(),
      getStatusPanel: () => null,
      getInputEl: () => ({ value: '' }),
      getFileContextManager: () => null,
      getLinkedContentController: () => ({ resetAutoDraft: jest.fn() }),
      getImageContextManager: () => null,
      getExternalContextSelector: () => null,
      clearQueuedMessage: jest.fn(),
      getExecutionCoordinator: () => null,
    } as unknown as ConversationControllerDeps;

    await new ConversationController(deps).createNew();

    expect(state.draftProjectId).toBeNull();
  });
});
