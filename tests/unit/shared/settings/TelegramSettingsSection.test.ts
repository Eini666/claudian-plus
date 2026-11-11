import { DEFAULT_CLAUDIAN_SETTINGS } from '@/app/settings/defaultSettings';
import type { ClaudianSettings } from '@/core/types/settings';
import {
  renderTelegramSettingsSection,
  type TelegramPanelPort,
  type TelegramSecrets,
} from '@/shared/settings/TelegramSettingsSection';

interface MockRow {
  desc: string;
  button?: { disabled: boolean; text: string; click: () => Promise<void> };
  text?: { inputEl: { value: string; type: string; blur: () => void } };
  dropdown?: { options: string[]; change: (value: string) => Promise<void> };
}

const mockRows = new Map<string, MockRow>();
const mockNotice = jest.fn();

jest.mock('@/i18n/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

jest.mock('obsidian', () => ({
  Notice: class {
    constructor(message: string) { mockNotice(message); }
  },
  Setting: class {
    private row: MockRow = { desc: '' };
    constructor(_container: unknown) {}
    setName(name: string) { mockRows.set(name, this.row); return this; }
    setDesc(desc: string) { this.row.desc = desc; return this; }
    addButton(cb: (button: unknown) => void) {
      const state = { disabled: false, text: '', click: async () => {} };
      const button = {
        setButtonText: (text: string) => { state.text = text; return button; },
        setDisabled: (disabled: boolean) => { state.disabled = disabled; return button; },
        onClick: (handler: () => Promise<void>) => { state.click = handler; return button; },
      };
      this.row.button = state;
      cb(button);
      return this;
    }
    addText(cb: (text: unknown) => void) {
      let blur = (): void => {};
      const inputEl = {
        value: '',
        type: 'text',
        addEventListener: (_event: string, handler: () => void) => { blur = handler; },
        blur: () => blur(),
      };
      const text = {
        inputEl,
        setValue: (value: string) => { inputEl.value = value; return text; },
        setPlaceholder: () => text,
        onChange: () => text,
      };
      this.row.text = text;
      cb(text);
      return this;
    }
    addDropdown(cb: (dropdown: unknown) => void) {
      const state = { options: [] as string[], change: async (_v: string) => {} };
      const dropdown = {
        addOption: (value: string) => { state.options.push(value); return dropdown; },
        setValue: () => dropdown,
        onChange: (handler: (value: string) => Promise<void>) => { state.change = handler; return dropdown; },
      };
      this.row.dropdown = state;
      cb(dropdown);
      return this;
    }
  },
}));

const K = 'settings.extras.telegram';
const READY = {
  obslugiwane: true as const,
  piper: 'p.exe',
  ffmpeg: 'f.exe',
  glosy: { 'pl_PL-gosia-medium': 'g.onnx' } as Record<string, string | null>,
  whisper: 'w.exe' as string | null,
  modeleMowy: { 'large-v3-turbo': 'l.bin', small: null } as Record<string, string | null>,
};

function setup(overrides: Partial<ClaudianSettings> = {}, portOverrides: Partial<TelegramPanelPort> = {}) {
  let stored: TelegramSecrets | null = null;
  const settings = { ...DEFAULT_CLAUDIAN_SETTINGS, telegramBridgeEnabled: true, ...overrides } as ClaudianSettings;
  const plugin = {
    settings,
    mutateSettings: jest.fn(async (mutation: (s: ClaudianSettings) => void) => { mutation(settings); }),
  };
  const port: TelegramPanelPort = {
    defaultFolder: 'C:/home/.claudian-plus/most',
    voices: ['pl_PL-gosia-medium', 'pl_PL-darkman-medium'],
    speechModels: ['large-v3-turbo', 'small'],
    readSecrets: () => stored,
    writeSecrets: jest.fn((s: TelegramSecrets) => { stored = s; }),
    startBridge: jest.fn(() => 'dziala' as const),
    startPairing: jest.fn(async () => 'sparowano' as const),
    toolsState: () => READY,
    toolSize: () => 50 * 1024 * 1024,
    install: jest.fn(async () => 'ok'),
    synthesize: jest.fn(async () => 'C:/tmp/test.ogg'),
    sendVoice: jest.fn(async () => {}),
    removeFile: jest.fn(),
    ...portOverrides,
  };
  const render = (): void => {
    mockRows.clear();
    renderTelegramSettingsSection({ container: {} as HTMLElement, plugin, port, rerender: render });
  };
  const withSecrets = (s: TelegramSecrets | null): void => { stored = s; render(); };
  mockNotice.mockClear();
  render();
  return { settings, plugin, port, withSecrets };
}

describe('renderTelegramSettingsSection', () => {
  it('shows only the folder in external mode and the full panel in built-in mode', async () => {
    setup({ telegramBridgeMode: 'external' });
    expect([...mockRows.keys()]).toEqual([`${K}.mode.name`, 'settings.extras.telegramBridgeDir.name']);

    await mockRows.get(`${K}.mode.name`)!.dropdown!.change('builtin');

    expect([...mockRows.keys()]).toEqual(expect.arrayContaining([
      `${K}.token.name`, `${K}.pair.name`, `${K}.tools.name`, `${K}.voice.name`, `${K}.test.name`,
    ]));
    expect(mockRows.get(`${K}.token.name`)!.text!.inputEl.type).toBe('password');
    expect(mockRows.get(`${K}.voice.name`)!.dropdown!.options).toEqual(['pl_PL-gosia-medium', 'pl_PL-darkman-medium']);
  });

  it('stores the token only through the secrets file, keeping the paired chat', () => {
    const { settings, plugin, port, withSecrets } = setup();
    withSecrets({ token: 'old-token', chatId: 42 });
    const before = JSON.stringify(settings);
    const field = mockRows.get(`${K}.token.name`)!.text!;

    field.inputEl.value = '  123:new-token ';
    field.inputEl.blur();

    expect(port.writeSecrets).toHaveBeenCalledWith({ token: '123:new-token', chatId: 42 });
    expect(port.startBridge).toHaveBeenCalledWith(true);
    expect(plugin.mutateSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(settings)).toBe(before);
    expect(JSON.stringify(settings)).not.toContain('new-token');
  });

  it('disables the test message until the phone is paired and the tools are installed', async () => {
    const missingFfmpeg = { ...READY, ffmpeg: null };
    const { withSecrets, port } = setup({}, { toolsState: () => missingFfmpeg });
    withSecrets({ token: 't', chatId: 42 });
    expect(mockRows.get(`${K}.test.name`)!.button!.disabled).toBe(true);

    (port as { toolsState: () => unknown }).toolsState = () => READY;
    withSecrets({ token: 't', chatId: null });
    expect(mockRows.get(`${K}.test.name`)!.button!.disabled).toBe(true);

    withSecrets({ token: 't', chatId: 42 });
    const test = mockRows.get(`${K}.test.name`)!.button!;
    expect(test.disabled).toBe(false);
    await test.click();
    expect(port.sendVoice).toHaveBeenCalledWith('C:/tmp/test.ogg');
    expect(port.removeFile).toHaveBeenCalledWith('C:/tmp/test.ogg');
    expect(mockNotice).toHaveBeenCalledWith(`${K}.test.sent`);
  });

  it('removes the voice file and hides the token when sending fails', async () => {
    const { withSecrets, port } = setup({}, {
      sendVoice: jest.fn(async () => { throw new Error('bad bot secret-token'); }),
    });
    withSecrets({ token: 'secret-token', chatId: 42 });

    await mockRows.get(`${K}.test.name`)!.button!.click();

    expect(port.removeFile).toHaveBeenCalledWith('C:/tmp/test.ogg');
    expect(mockNotice).toHaveBeenCalledTimes(1);
    expect(mockNotice.mock.calls[0][0]).not.toContain('secret-token');
  });

  it('offers one install for the missing tools with their total size', async () => {
    const { port } = setup({}, { toolsState: () => ({ ...READY, piper: null, ffmpeg: null }) });
    const tools = mockRows.get(`${K}.tools.name`)!;
    expect(tools.button!.text).toBe(`${K}.tools.install {"mb":100}`);

    await tools.button!.click();

    expect((port.install as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['piper', 'ffmpeg']);
  });

  it('speech row: shows whisper and model status, installs what is missing and restarts the bridge', async () => {
    const { port } = setup({}, { toolsState: () => ({ ...READY, whisper: null, ffmpeg: null }) });
    const speech = mockRows.get(`${K}.speech.name`)!;
    expect(speech.desc).toBe(
      `${K}.speech.desc Whisper: ${K}.tools.missing · large-v3-turbo: ${K}.tools.ready`,
    );
    expect(speech.button!.text).toBe(`${K}.tools.install {"mb":100}`);
    expect(speech.dropdown!.options).toEqual(['large-v3-turbo', 'small']);

    await speech.button!.click();

    expect((port.install as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['whisper', 'ffmpeg']);
    expect(port.startBridge).toHaveBeenCalledWith(false);
  });

  it('speech row: everything ready has no install button; changing the model saves whisperModel', async () => {
    const { settings, plugin } = setup();
    expect(mockRows.get(`${K}.speech.name`)!.button).toBeUndefined();

    await mockRows.get(`${K}.speech.name`)!.dropdown!.change('small');

    expect(plugin.mutateSettings).toHaveBeenCalled();
    expect(settings.whisperModel).toBe('small');
    const speech = mockRows.get(`${K}.speech.name`)!;
    expect(speech.desc).toContain(`small: ${K}.tools.missing`);
    expect(speech.button!.text).toBe(`${K}.tools.install {"mb":50}`);
  });

  it('shows "Windows only" and no install button on other platforms', () => {
    setup({}, { toolsState: () => ({ obslugiwane: false }) });
    const tools = mockRows.get(`${K}.tools.name`)!;
    expect(tools.desc).toBe(`${K}.tools.windowsOnly`);
    expect(tools.button).toBeUndefined();
    expect(mockRows.get(`${K}.test.name`)!.button!.disabled).toBe(true);
  });

  it('pairs the phone and reports the connection', async () => {
    const { withSecrets, port } = setup();
    withSecrets({ token: 't', chatId: null });
    const pair = mockRows.get(`${K}.pair.name`)!;
    expect(pair.desc).toBe(`${K}.pair.unpaired`);

    await pair.button!.click();

    expect(port.startPairing).toHaveBeenCalledWith(120, expect.stringMatching(/^\d{6}$/));
    expect(mockNotice).toHaveBeenCalledWith(`${K}.pair.done`);
  });
});
