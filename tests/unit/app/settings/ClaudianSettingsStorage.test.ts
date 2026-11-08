import '@/providers';

import {
  CLAUDIAN_SETTINGS_PATH,
  ClaudianSettingsStorage,
} from '@/app/settings/ClaudianSettingsStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function createAdapter(
  stored: Record<string, unknown>,
): jest.Mocked<VaultFileAdapter> {
  return {
    exists: jest.fn().mockImplementation(async (path: string) => (
      path === CLAUDIAN_SETTINGS_PATH
    )),
    read: jest.fn().mockResolvedValue(JSON.stringify(stored)),
    write: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<VaultFileAdapter>;
}

describe('ClaudianSettingsStorage optional integrations', () => {
  it('fills missing assistant and integration keys with defaults without touching stored values', async () => {
    const storage = new ClaudianSettingsStorage(createAdapter({
      userName: 'Jan',
      showAriWidget: true,
    }));

    const settings = await storage.load();

    expect(settings).toMatchObject({
      userName: 'Jan',
      showAriWidget: true,
      assistantName: 'Claude',
      showAvatarBadge: true,
      accountSwitcherEnabled: false,
      accountsPanelUrl: 'http://127.0.0.1:7788',
      telegramBridgeEnabled: false,
      telegramBridgeDir: '',
    });
  });

  it.each([
    ['legacy folder without mode -> external', { telegramBridgeEnabled: true, telegramBridgeDir: 'C:\\Narzedzia\\most-telegrama' }, 'external'],
    ['legacy without folder -> builtin', { telegramBridgeEnabled: true, telegramBridgeDir: '  ' }, 'builtin'],
    ['fresh install -> builtin', {}, 'builtin'],
    ['stored mode wins over folder', { telegramBridgeMode: 'builtin', telegramBridgeDir: 'C:/J' }, 'builtin'],
    ['invalid mode falls back to migration', { telegramBridgeMode: 'x', telegramBridgeDir: 'C:/J' }, 'external'],
  ])('telegramBridgeMode: %s', async (_name, stored, expected) => {
    const adapter = createAdapter(stored);
    const settings = await new ClaudianSettingsStorage(adapter).load();

    expect(settings.telegramBridgeMode).toBe(expected);
    expect(settings.voiceName).toBe('pl_PL-gosia-medium');
    expect(settings.whisperModel).toBe('large-v3-turbo');
  });

  it('keeps an enabled Telegram bridge and its folder across save and load', async () => {
    const adapter = createAdapter({});
    const storage = new ClaudianSettingsStorage(adapter);

    await storage.save({
      ...await storage.load(),
      telegramBridgeEnabled: true,
      telegramBridgeDir: 'C:/Bridge/telegram',
    });
    const persisted = adapter.write.mock.calls.at(-1)![1];
    adapter.read.mockResolvedValue(persisted);

    await expect(new ClaudianSettingsStorage(adapter).load()).resolves.toMatchObject({
      telegramBridgeEnabled: true,
      telegramBridgeDir: 'C:/Bridge/telegram',
    });
  });
});

describe('ClaudianSettingsStorage Linked content migration', () => {
  it('imports legacy organization and pinned paths before defaults and awaits canonical persistence', async () => {
    const adapter = createAdapter({
      sessionManagerOrganization: 'linked-note',
      pinnedLinkedNotePaths: [
        'Notes\\Plan.md',
        './Notes/Plan.md',
        'Projects//Research',
        '../outside',
      ],
    });
    let releaseWrite!: () => void;
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    adapter.write.mockImplementation(() => new Promise<void>((resolve) => {
      signalWriteStarted();
      releaseWrite = resolve;
    }));
    const storage = new ClaudianSettingsStorage(adapter);

    let resolved = false;
    const load = storage.load().then((settings) => {
      resolved = true;
      return settings;
    });
    await writeStarted;

    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    releaseWrite();

    await expect(load).resolves.toMatchObject({
      sessionManagerOrganization: 'linked-content',
      pinnedLinkedContentPaths: [
        'Notes/Plan.md',
        'Projects/Research',
      ],
    });
    const persisted = JSON.parse(adapter.write.mock.calls[0][1]);
    expect(persisted.sessionManagerOrganization).toBe('linked-content');
    expect(persisted.pinnedLinkedContentPaths).toEqual([
      'Notes/Plan.md',
      'Projects/Research',
    ]);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });

  it('lets an explicitly stored canonical empty list win over legacy pins', async () => {
    const adapter = createAdapter({
      pinnedLinkedContentPaths: [],
      pinnedLinkedNotePaths: ['Notes/Legacy.md'],
    });
    const storage = new ClaudianSettingsStorage(adapter);

    const settings = await storage.load();

    expect(settings.pinnedLinkedContentPaths).toEqual([]);
    expect(adapter.write).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(adapter.write.mock.calls[0][1]);
    expect(persisted.pinnedLinkedContentPaths).toEqual([]);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });

  it('normalizes canonical pins without falling back to the legacy field', async () => {
    const adapter = createAdapter({
      pinnedLinkedContentPaths: [
        'Projects\\Current',
        './Projects/Current',
        '../invalid',
      ],
      pinnedLinkedNotePaths: ['Notes/Legacy.md'],
    });
    const storage = new ClaudianSettingsStorage(adapter);

    const settings = await storage.load();

    expect(settings.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    const persisted = JSON.parse(adapter.write.mock.calls[0][1]);
    expect(persisted.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });

  it('omits legacy pinned paths from future writes', async () => {
    const adapter = createAdapter({});
    const storage = new ClaudianSettingsStorage(adapter);

    await storage.save({
      ...await storage.load(),
      pinnedLinkedContentPaths: ['Projects/Current'],
      pinnedLinkedNotePaths: ['Notes/Legacy.md'],
    });

    const persisted = JSON.parse(adapter.write.mock.calls.at(-1)![1]);
    expect(persisted.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    expect(persisted).not.toHaveProperty('pinnedLinkedNotePaths');
  });
});
