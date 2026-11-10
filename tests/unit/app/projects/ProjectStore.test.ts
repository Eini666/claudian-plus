import { type ProjectConversationRepository, ProjectStore } from '@/app/projects/ProjectStore';
import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import type { ClaudianSettings, ProjectRecord } from '@/core/types';

function createFixture(initialProjects: ProjectRecord[] = []) {
  const settings = { projects: [...initialProjects] } as ClaudianSettings;
  const persist = jest.fn().mockResolvedValue(undefined);
  const conversations = [
    { id: 'a', projectId: 'p1' as string | undefined },
    { id: 'b', projectId: 'p2' as string | undefined },
    { id: 'c', projectId: 'p1' as string | undefined },
    { id: 'd', projectId: undefined as string | undefined },
  ];
  const repository: jest.Mocked<ProjectConversationRepository> = {
    list: jest.fn(() => conversations),
    setProject: jest.fn(async (id: string, projectId: string | null) => {
      const conversation = conversations.find(item => item.id === id);
      if (conversation) conversation.projectId = projectId ?? undefined;
    }),
  };
  let nextId = 0;
  const store = new ProjectStore({
    settingsCoordinator: new SettingsCoordinator(settings, persist),
    getSettings: () => settings,
    repository,
    createId: () => `id-${++nextId}`,
    now: () => 1000,
  });
  return { store, settings, persist, repository, conversations };
}

const p1: ProjectRecord = { id: 'p1', name: 'Claudian', createdAt: 1 };
const p2: ProjectRecord = { id: 'p2', name: 'JARVIS', createdAt: 2 };

describe('ProjectStore', () => {
  it('creates a project with a trimmed name, unique id and createdAt', async () => {
    const { store, settings, persist } = createFixture();

    const first = await store.create('  Claudian ');
    const second = await store.create('Claudian');

    expect(first).toEqual({ id: 'id-1', name: 'Claudian', createdAt: 1000 });
    expect(second?.id).toBe('id-2');
    expect(settings.projects).toEqual([first, second]);
    expect(store.list()).toEqual([first, second]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('rejects a blank name without writing settings', async () => {
    const { store, settings, persist } = createFixture();

    await expect(store.create('   ')).resolves.toBeNull();
    await expect(store.create('')).resolves.toBeNull();

    expect(settings.projects).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });

  it('renames and pins only the target project', async () => {
    const { store, settings, persist } = createFixture([p1, p2]);

    await expect(store.rename('p1', '  Claudian Plus ')).resolves.toBe(true);
    await expect(store.setPinned('p2', true)).resolves.toBe(true);

    expect(settings.projects).toEqual([
      { ...p1, name: 'Claudian Plus' },
      { ...p2, isPinned: true },
    ]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('ignores unchanged, blank or unknown rename and pin requests', async () => {
    const { store, settings, persist } = createFixture([p1]);

    await expect(store.rename('p1', 'Claudian')).resolves.toBe(false);
    await expect(store.rename('p1', '  ')).resolves.toBe(false);
    await expect(store.rename('missing', 'X')).resolves.toBe(false);
    await expect(store.setPinned('p1', false)).resolves.toBe(false);
    await expect(store.setPinned('missing', true)).resolves.toBe(false);

    expect(settings.projects).toEqual([p1]);
    expect(persist).not.toHaveBeenCalled();
  });

  it('deletes the record and clears projectId only on its conversations', async () => {
    const { store, settings, repository, conversations } = createFixture([p1, p2]);

    await expect(store.delete('p1')).resolves.toBe(true);

    expect(settings.projects).toEqual([p2]);
    expect(repository.setProject).toHaveBeenCalledTimes(2);
    expect(repository.setProject).toHaveBeenCalledWith('a', null);
    expect(repository.setProject).toHaveBeenCalledWith('c', null);
    expect(conversations.map(item => item.projectId)).toEqual([undefined, 'p2', undefined, undefined]);
  });

  it('does nothing when deleting an unknown project', async () => {
    const { store, persist, repository } = createFixture([p1]);

    await expect(store.delete('missing')).resolves.toBe(false);

    expect(persist).not.toHaveBeenCalled();
    expect(repository.setProject).not.toHaveBeenCalled();
  });

  it('resolves live projects and returns null for missing ids', () => {
    const { store } = createFixture([p1]);

    expect(store.get('p1')).toEqual(p1);
    expect(store.resolve('p1')).toEqual(p1);
    expect(store.resolve('gone')).toBeNull();
    expect(store.resolve(undefined)).toBeNull();
    expect(store.get('gone')).toBeNull();
  });

  it('treats missing settings list as empty', () => {
    const settings = {} as ClaudianSettings;
    const store = new ProjectStore({
      settingsCoordinator: new SettingsCoordinator(settings, jest.fn().mockResolvedValue(undefined)),
      getSettings: () => settings,
      repository: { list: () => [], setProject: jest.fn() },
    });

    expect(store.list()).toEqual([]);
  });
});
