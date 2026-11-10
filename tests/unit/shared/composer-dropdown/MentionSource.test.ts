import type { TFile } from 'obsidian';

import { MentionSource } from '@/shared/composer-dropdown/MentionSource';
import { selectMentionableSessions } from '@/shared/composer-dropdown/sessionMentionFolder';

function file(path: string, mtime = 1): TFile {
  const name = path.split('/').pop() ?? path;
  return {
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.includes('.') ? name.split('.').pop() : '',
    name,
    path,
    stat: { ctime: mtime, mtime, size: 10 },
  } as TFile;
}

function source(overrides: Record<string, unknown> = {}) {
  const onAttachFile = jest.fn();
  const onAgentMentionSelect = jest.fn();
  const value = new MentionSource({
    getCachedVaultFiles: () => [file('notes/Alpha.md', 5)],
    getCachedVaultFolders: () => [{ name: 'notes', path: 'notes' }],
    getExternalContexts: () => [],
    normalizePathForVault: path => path ?? null,
    onAgentMentionSelect,
    onAttachFile,
    ...overrides,
  });
  return { onAgentMentionSelect, onAttachFile, source: value };
}

describe('MentionSource', () => {
  it('opts input-driven loads into debounce while keeping the source API otherwise unchanged', () => {
    const { source: value } = source();

    expect(value.inputLoadPolicy).toBe('debounced');

    value.destroy();
  });

  it('matches @ at a token boundary and preserves file names containing spaces', () => {
    const { source: value } = source();
    expect(value.match('Ask @Al', 7)).toEqual(expect.objectContaining({ query: 'Al' }));
    expect(value.match('mail@example', 12)).toBeNull();
    expect(value.match('@Alpha note', 11)).toEqual(expect.objectContaining({
      query: 'Alpha note',
    }));
    value.destroy();
  });

  it('lists Vault files and folders and preserves attachment side effects', async () => {
    const { onAttachFile, source: value } = source();
    const match = value.match('@alp', 4)!;
    const items = await value.load(match, new AbortController().signal);
    const fileItem = items.find(item => item.kind === 'value' && item.label === 'notes/Alpha.md');
    expect(fileItem).toEqual(expect.objectContaining({ replacement: '@notes/Alpha.md ' }));
    const action = value.select(fileItem as Extract<typeof fileItem, { kind: 'value' }>, match);
    if (action.kind === 'replace') action.onApplied?.();
    expect(onAttachFile).toHaveBeenCalledWith('notes/Alpha.md');

    const rootItems = await value.load(value.match('@notes', 6)!, new AbortController().signal);
    expect(rootItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '@notes/' }),
    ]));
    value.destroy();
  });

  it('loads async extension folders without owning their feature semantics', async () => {
    const { source: value } = source();
    value.setExtensionFoldersLoader(async () => [{
      id: 'extension',
      kind: 'folder',
      label: "Member's Changes",
      load: () => [],
    }]);
    const items = await value.load(value.match('@member', 7)!, new AbortController().signal);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'extension', label: "Member's Changes" }),
    ]));
    value.destroy();
  });

  it('keeps base mentions available when an optional extension fails', async () => {
    const { source: value } = source();
    value.setExtensionFoldersLoader(async () => {
      throw new Error('Collab unavailable');
    });

    const items = await value.load(value.match('@alp', 4)!, new AbortController().signal);

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'notes/Alpha.md' }),
    ]));
    value.destroy();
  });

  it('loads and selects provider-neutral Agent mentions', async () => {
    const { onAgentMentionSelect, source: value } = source();
    value.setAgentService({
      ensureLoaded: jest.fn(async () => undefined),
      isLoaded: () => true,
      searchAgents: () => [{
        id: 'reviewer',
        name: 'reviewer',
        description: 'Review changes',
        source: 'vault',
      }],
    });
    const [folder] = await value.load(value.match('@Agents', 7)!, new AbortController().signal);
    expect(folder).toEqual(expect.objectContaining({ id: 'agents', kind: 'folder' }));
    const [agent] = await (folder as Extract<typeof folder, { kind: 'folder' }>)
      .load('', new AbortController().signal);
    const action = value.select(agent as Extract<typeof agent, { kind: 'value' }>, value.match('@', 1)!);
    if (action.kind === 'replace') action.onApplied?.();
    expect(onAgentMentionSelect).toHaveBeenCalledWith('reviewer');
    value.destroy();
  });

  describe('session mentions', () => {
    const conversations = [
      { id: 'cur00001', lastActivityAt: 50, title: 'Bieżąca praca' },
      { id: 'arc00002', isArchived: true, lastActivityAt: 40, title: 'Projekty — stare' },
      { id: 'prt00003', lastActivityAt: 30, title: 'Projekty — port' },
      { id: 'a1b2c3d4', lastActivityAt: 20, title: 'Notatki' },
      { id: 'e5f6a7b8', lastActivityAt: 10, title: 'Notatki' },
    ];
    const getSessions = () => selectMentionableSessions(conversations, 'cur00001');

    it('suggests matching sessions at root without the current and archived ones', async () => {
      const onAttachSession = jest.fn();
      const { source: value } = source({ getSessions, onAttachSession });
      const match = value.match('@pr', 3)!;
      const items = await value.load(match, new AbortController().signal);
      const sessionItems = items.filter(item => item.id.startsWith('session:'));
      expect(sessionItems).toEqual([
        expect.objectContaining({
          icon: 'messages-square',
          label: 'Projekty — port',
          replacement: '@[Projekty — port] ',
        }),
      ]);
      expect(getSessions().map(session => session.id)).toEqual(['prt00003', 'a1b2c3d4', 'e5f6a7b8']);

      const action = value.select(sessionItems[0] as Extract<typeof sessionItems[0], { kind: 'value' }>, match);
      if (action.kind === 'replace') action.onApplied?.();
      expect(onAttachSession).toHaveBeenCalledWith(expect.objectContaining({
        id: 'prt00003',
        token: '@[Projekty — port]',
      }));
      value.destroy();
    });

    it('gives colliding titles distinct tokens with an id suffix', async () => {
      const { source: value } = source({ getSessions });
      const items = await value.load(value.match('@notat', 6)!, new AbortController().signal);
      const replacements = items
        .filter(item => item.id.startsWith('session:'))
        .map(item => (item as Extract<typeof item, { kind: 'value' }>).replacement);
      expect(replacements).toEqual(['@[Notatki · a1b2] ', '@[Notatki · e5f6] ']);
      value.destroy();
    });

    it('lists every session in the Sessions folder, newest first', async () => {
      const { source: value } = source({ getSessions });
      const root = await value.load(value.match('@', 1)!, new AbortController().signal);
      const folder = root.find(item => item.id === 'sessions');
      expect(folder).toEqual(expect.objectContaining({ kind: 'folder', inputPrefix: 'Sessions/' }));
      const inside = await value.load(value.match('@Sessions/', 10)!, new AbortController().signal);
      expect(inside.map(item => item.label)).toEqual(['Projekty — port', 'Notatki', 'Notatki']);
      value.destroy();
    });
  });
});
