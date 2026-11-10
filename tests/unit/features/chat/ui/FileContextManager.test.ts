import { TFile, TFolder } from 'obsidian';

import { FileContextManager } from '@/features/chat/ui/FileContext';
import type { ExternalContextFile } from '@/utils/externalContextScanner';

let mockVaultPath = '/vault';
jest.mock('@/utils/path', () => {
  const actual = jest.requireActual('@/utils/path');
  return {
    ...actual,
    getVaultPath: jest.fn(() => mockVaultPath),
  };
});

const mockScanPaths = jest.fn<ExternalContextFile[], [string[]]>(() => []);
jest.mock('@/utils/externalContextScanner', () => ({
  externalContextScanner: {
    scanPaths: (paths: string[]) => mockScanPaths(paths),
  },
}));

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? '',
    basename: (path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''),
    extension: path.split('.').pop() ?? '',
    stat: { ctime: 0, mtime: 0, size: 0 },
  });
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? '' });
  return folder;
}

function createMockApp(entries: Array<TFile | TFolder> = []) {
  const handlers = new Map<string, (...args: any[]) => void>();
  return {
    handlers,
    app: {
      vault: {
        on: jest.fn((event: string, handler: (...args: any[]) => void) => {
          handlers.set(event, handler);
          return { event };
        }),
        offref: jest.fn(),
        getFiles: jest.fn(() => entries.filter((entry): entry is TFile => entry instanceof TFile)),
        getAllLoadedFiles: jest.fn(() => entries),
      },
    } as never,
  };
}

function attachVaultFile(manager: FileContextManager, path: string): void {
  const action = manager.getMentionSource().select({
    id: `vault-file:${path}`,
    kind: 'value',
    label: path,
    replacement: `@${path}`,
    value: { kind: 'vault-file', path },
  }, {
    atInputStart: true,
    end: path.length,
    query: path,
    start: 0,
    trigger: '@',
  });
  if (action.kind !== 'replace') throw new Error('Expected a replace action');
  action.onApplied?.();
}

describe('FileContextManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockVaultPath = '/vault';
    mockScanPaths.mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('owns attachments without exposing Linked content, session, or sent state', () => {
    const { app } = createMockApp();
    const manager = new FileContextManager(app, {});

    attachVaultFile(manager, 'Notes/Attached.md');

    expect(manager.getAttachedFiles()).toEqual(new Set(['Notes/Attached.md']));
    const leaked = manager.getAttachedFiles();
    leaked.add('Notes/Leaked.md');
    expect(manager.getAttachedFiles()).toEqual(new Set(['Notes/Attached.md']));
    expect(manager).not.toHaveProperty('currentNotePath');
    expect(manager).not.toHaveProperty('getCurrentNotePath');
    expect(manager).not.toHaveProperty('isSessionStarted');
    expect(manager).not.toHaveProperty('shouldSendCurrentNote');
    manager.clearAttachments();
    expect(manager.getAttachedFiles()).toEqual(new Set());
    manager.destroy();
  });

  it('mechanically exposes the shared Vault file and folder caches', () => {
    const note = createFile('Notes/Plan.md');
    const folder = createFolder('Projects');
    const { app } = createMockApp([note, folder]);
    const manager = new FileContextManager(app, {});

    expect(manager.getCachedVaultFiles()).toEqual([note]);
    expect(manager.getCachedVaultFolders()).toEqual([{ name: 'Projects', path: 'Projects' }]);
    expect(() => manager.markFileCacheDirty()).not.toThrow();
    expect(() => manager.markFolderCacheDirty()).not.toThrow();
    manager.destroy();
  });

  it('rewrites attached file paths for exact and descendant renames', () => {
    const { app, handlers } = createMockApp();
    const manager = new FileContextManager(app, {});
    attachVaultFile(manager, 'Exact.md');
    attachVaultFile(manager, 'Projects/Old/Plan.md');

    handlers.get('rename')?.(createFile('Renamed.md'), 'Exact.md');
    handlers.get('rename')?.(createFolder('Projects/New'), 'Projects/Old');

    expect(manager.getAttachedFiles()).toEqual(new Set([
      'Renamed.md',
      'Projects/New/Plan.md',
    ]));
    manager.destroy();
  });

  it('removes attached paths for file and folder deletion', () => {
    const { app, handlers } = createMockApp();
    const manager = new FileContextManager(app, {});
    attachVaultFile(manager, 'Projects/Plan.md');
    attachVaultFile(manager, 'Other.md');

    handlers.get('delete')?.(createFolder('Projects'));
    handlers.get('delete')?.(createFile('Other.md'));

    expect(manager.getAttachedFiles()).toEqual(new Set());
    manager.destroy();
  });

  it('keeps external mention transformation and agent delegation', () => {
    const externalFile: ExternalContextFile = {
      contextRoot: '/external/Project',
      name: 'Plan.md',
      path: '/external/Project/Plan.md',
      relativePath: 'Plan.md',
      mtime: 0,
    };
    mockScanPaths.mockReturnValue([externalFile]);
    const onAgentMentionSelect = jest.fn();
    const { app } = createMockApp();
    const manager = new FileContextManager(app, {
      getExternalContexts: () => ['/external/Project'],
      onAgentMentionSelect,
    });

    expect(manager.transformContextMentions('Review @Project/Plan.md.'))
      .toBe('Review /external/Project/Plan.md.');
    expect(() => manager.setAgentService(null)).not.toThrow();
    expect(() => manager.preScanExternalContexts()).not.toThrow();
    manager.destroy();
  });

  it('rolls back acquired listeners on construction failure and destroys idempotently', () => {
    const { app } = createMockApp();
    const deleteRef = { event: 'delete' };
    const failure = new Error('rename listener failed');
    (app as any).vault.on
      .mockReturnValueOnce(deleteRef)
      .mockImplementationOnce(() => { throw failure; });

    expect(() => new FileContextManager(app, {})).toThrow(failure);
    expect((app as any).vault.offref).toHaveBeenCalledWith(deleteRef);

    const healthy = createMockApp();
    const manager = new FileContextManager(healthy.app, {});
    manager.destroy();
    manager.destroy();
    expect((healthy.app as any).vault.offref).toHaveBeenCalledTimes(2);
  });

  describe('session mentions', () => {
    const updated = Date.UTC(2026, 10, 9, 12, 0, 0);
    const sessions = [
      { id: 'aaaa1111', lastActivityAt: updated, title: 'Projekty — port' },
      { id: 'bbbb2222', lastActivityAt: updated - 1000, title: 'Głos' },
    ];

    async function attachSession(manager: FileContextManager, title: string): Promise<string> {
      const source = manager.getMentionSource();
      const match = source.match(`@${title}`, title.length + 1)!;
      const items = await source.load(match, new AbortController().signal);
      const item = items.find(entry => entry.kind === 'value' && entry.label === title);
      if (!item || item.kind !== 'value') throw new Error(`No session item for ${title}`);
      const action = source.select(item, match);
      if (action.kind !== 'replace') throw new Error('Expected a replace action');
      action.onApplied?.();
      return action.text;
    }

    it('emits one block per mentioned session still present in the text', async () => {
      const { app } = createMockApp();
      const manager = new FileContextManager(app, { getSessions: () => sessions });

      const first = await attachSession(manager, 'Projekty — port');
      const second = await attachSession(manager, 'Głos');
      expect(first).toBe('@[Projekty — port] ');

      expect(manager.buildSessionMentionContext(`zobacz ${first}`)).toEqual([
        `<context_session id="aaaa1111" title="Projekty — port" updated="${new Date(updated).toISOString()}" />`,
      ]);
      expect(manager.buildSessionMentionContext(`${first}i ${second}`)).toHaveLength(2);
      expect(manager.buildSessionMentionContext(`${first}${first}`)).toHaveLength(1);
      expect(manager.buildSessionMentionContext('token skasowany')).toEqual([]);

      manager.clearAttachments();
      expect(manager.buildSessionMentionContext(first)).toEqual([]);
      manager.destroy();
    });
  });
});
