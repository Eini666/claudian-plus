import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import type { ClaudianSettings } from '@/core/types/settings';
import { renderExtrasSettingsSection } from '@/shared/settings/ExtrasSettingsSection';

const mockRendered: string[] = [];
const mockToggles = new Map<string, (value: boolean) => Promise<void>>();
const mockTexts = new Map<string, {
  onChange?: (value: string) => Promise<void>;
  inputEl: { value: string; blur: () => void };
  setValue: jest.Mock;
}>();
const mockNotice = jest.fn();

jest.mock('@/i18n/i18n', () => ({ t: (key: string) => key }));

jest.mock('obsidian', () => ({
  Notice: class {
    constructor(message: string) {
      mockNotice(message);
    }
  },
  Setting: class {
    private name = '';
    constructor(_container: unknown) {}
    setName(name: string) {
      this.name = name;
      mockRendered.push(name);
      return this;
    }
    setDesc() { return this; }
    setHeading() { return this; }
    addToggle(cb: (toggle: unknown) => void) {
      const toggle = {
        setValue: () => toggle,
        onChange: (handler: (value: boolean) => Promise<void>) => {
          mockToggles.set(this.name, handler);
          return toggle;
        },
      };
      cb(toggle);
      return this;
    }
    addDropdown(cb: (dropdown: unknown) => void) {
      const dropdown = { addOption: () => dropdown, setValue: () => dropdown, onChange: () => dropdown };
      cb(dropdown);
      return this;
    }
    addButton(cb: (button: unknown) => void) {
      const button = { setButtonText: () => button, setDisabled: () => button, onClick: () => button };
      cb(button);
      return this;
    }
    addText(cb: (text: unknown) => void) {
      let blurHandler = (): void => {};
      const entry: Record<string, unknown> & { inputEl: Record<string, unknown> & { value: string } } = {
        inputEl: {
          value: '',
          addEventListener: (_event: string, handler: () => void) => { blurHandler = handler; },
          blur: () => blurHandler(),
        },
        setValue: jest.fn((value: string) => { entry.inputEl.value = value; return entry; }),
        setPlaceholder: () => entry,
        onChange: (handler: (value: string) => Promise<void>) => {
          (entry as { onChange?: unknown }).onChange = handler;
          return entry;
        },
      };
      mockTexts.set(this.name, entry as never);
      cb(entry);
      return this;
    }
  },
}));

function setup(overrides: Partial<ClaudianSettings> = {}) {
  mockRendered.length = 0;
  mockToggles.clear();
  mockTexts.clear();
  mockNotice.mockClear();
  const settings = { ...DEFAULT_CLAUDIAN_SETTINGS, ...overrides } as ClaudianSettings;
  const plugin = {
    settings,
    mutateSettings: jest.fn(async (mutation: (s: ClaudianSettings) => void) => { mutation(settings); }),
  };
  const body = {
    empty: () => {
      mockRendered.length = 0;
      mockToggles.clear();
      mockTexts.clear();
    },
  };
  const container = { createDiv: jest.fn(() => body) } as unknown as HTMLElement;
  const onDesktopAvatarChange = jest.fn();
  const telegram = {
    defaultFolder: '',
    voices: [],
    speechModels: [],
    readSecrets: () => null,
    writeSecrets: jest.fn(),
    startBridge: () => 'wylaczony' as const,
    startPairing: jest.fn(),
    toolsState: () => ({ obslugiwane: false as const }),
    toolSize: () => 0,
    install: jest.fn(),
    synthesize: jest.fn(),
    sendVoice: jest.fn(),
    removeFile: jest.fn(),
  };
  renderExtrasSettingsSection({ container, plugin, onDesktopAvatarChange, telegram });
  return { settings, plugin, onDesktopAvatarChange };
}

describe('renderExtrasSettingsSection', () => {
  it('shows the bridge folder only after the bridge is enabled', async () => {
    const { settings } = setup();
    expect(mockRendered).toContain('settings.extras.telegramBridge.name');
    expect(mockRendered).not.toContain('settings.extras.telegramBridgeDir.name');

    await mockToggles.get('settings.extras.telegramBridge.name')!(true);

    expect(settings.telegramBridgeEnabled).toBe(true);
    expect(mockRendered).toContain('settings.extras.telegramBridgeDir.name');
  });

  it('saves the assistant name and falls back to Claude when blank', async () => {
    const { settings } = setup();
    const name = mockTexts.get('settings.extras.assistantName.name')!;

    await name.onChange!('Ari');
    expect(settings.assistantName).toBe('Ari');

    await name.onChange!('   ');
    expect(settings.assistantName).toBe('Claude');
  });

  it('rejects an accounts panel URL without http(s)', async () => {
    const { settings, plugin } = setup({ accountSwitcherEnabled: true });
    const url = mockTexts.get('settings.extras.accountsPanelUrl.name')!;

    url.inputEl.value = 'ftp://panel';
    url.inputEl.blur();
    expect(settings.accountsPanelUrl).toBe('http://127.0.0.1:7788');
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
    expect(mockNotice).toHaveBeenCalledWith('settings.extras.accountsPanelUrl.invalid');
    expect(url.setValue).toHaveBeenLastCalledWith('http://127.0.0.1:7788');

    url.inputEl.value = 'https://panel.local:8080';
    url.inputEl.blur();
    await Promise.resolve();
    expect(settings.accountsPanelUrl).toBe('https://panel.local:8080');
  });

  it('applies the desktop avatar toggle immediately', async () => {
    const { settings, onDesktopAvatarChange } = setup();
    await mockToggles.get('settings.extras.showAriWidget.name')!(true);
    expect(settings.showAriWidget).toBe(true);
    expect(onDesktopAvatarChange).toHaveBeenCalledWith(true);
  });
});
