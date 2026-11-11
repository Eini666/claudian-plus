import { type ButtonComponent, Notice, Setting } from 'obsidian';

import type { ClaudianSettings } from '../../core/types/settings';
import { t } from '../../i18n/i18n';
import type { TranslationKey } from '../../i18n/types';

export interface TelegramSecrets {
  token: string;
  chatId: number | null;
}

export type VoiceToolsState =
  | { obslugiwane: false }
  | {
    obslugiwane: true;
    piper: string | null;
    ffmpeg: string | null;
    glosy: Record<string, string | null>;
    whisper: string | null;
    modeleMowy: Record<string, string | null>;
  };

/** Most i narzedzia glosu z `features/telegram`; `src/shared` dostaje je z ClaudianSettings. */
export interface TelegramPanelPort {
  defaultFolder: string;
  voices: readonly string[];
  speechModels: readonly string[];
  readSecrets(): TelegramSecrets | null;
  writeSecrets(secrets: TelegramSecrets): void;
  /** `restart` = zatrzymaj klienta przed startem, zeby wczytal nowy token. */
  startBridge(restart: boolean): 'dziala' | 'brak-tokenu' | 'zajete' | 'wylaczony';
  startPairing(seconds: number, code: string): Promise<'sparowano' | 'czas-minal' | 'przerwano'>;
  toolsState(): VoiceToolsState;
  toolSize(tool: string): number;
  install(tool: string, progress: (done: number, total: number) => void): Promise<unknown>;
  synthesize(text: string, voice: string): Promise<string>;
  sendVoice(oggPath: string): Promise<void>;
  removeFile(filePath: string): void;
}

interface TelegramSettingsHost {
  readonly settings: ClaudianSettings;
  mutateSettings(mutation: (settings: ClaudianSettings) => void | Promise<void>): Promise<void>;
}

interface TelegramSettingsSectionOptions {
  container: HTMLElement;
  plugin: TelegramSettingsHost;
  port: TelegramPanelPort;
  /** Odswieza cala sekcje „Dodatki” (ten panel zyje w jej kontenerze). */
  rerender: () => void;
}

const PAIRING_SECONDS = 120;
const MB = 1024 * 1024;

/** Bledy przetrwaja odswiezenie sekcji; ciagnace sie operacje tez. */
const toolErrors = new Map<string, string>();
let busy: 'pairing' | 'install' | 'test' | null = null;

const voiceLabel = (voice: string): string => voice.replace(/^pl_PL-/, '').replace(/-medium$/, '');

const errorText = (err: unknown, token?: string): string => {
  const message = err instanceof Error ? err.message : String(err);
  return t('settings.extras.telegram.error', { message: token ? message.split(token).join('***') : message });
};

export function renderTelegramSettingsSection(options: TelegramSettingsSectionOptions): void {
  const { container, plugin, port, rerender } = options;
  const settings = plugin.settings;
  const builtin = settings.telegramBridgeMode === 'builtin';

  new Setting(container)
    .setName(t('settings.extras.telegram.mode.name'))
    .addDropdown((dropdown) => {
      dropdown
        .addOption('builtin', t('settings.extras.telegram.mode.builtin'))
        .addOption('external', t('settings.extras.telegram.mode.external'))
        .setValue(settings.telegramBridgeMode)
        .onChange(async (value) => {
          await plugin.mutateSettings((s) => { s.telegramBridgeMode = value === 'external' ? 'external' : 'builtin'; });
          rerender();
        });
    });

  // W trybie wbudowanym folder jest opcjonalny: puste pole = domyslny folder w ~/.claudian-plus.
  new Setting(container)
    .setName(t('settings.extras.telegramBridgeDir.name'))
    .addText((text) => {
      text
        .setPlaceholder(builtin ? port.defaultFolder : t('settings.extras.telegramBridgeDir.placeholder'))
        .setValue(settings.telegramBridgeDir)
        .onChange((value) => plugin.mutateSettings((s) => { s.telegramBridgeDir = value.trim(); }));
    });

  if (!builtin) return;

  const secrets = port.readSecrets();

  new Setting(container)
    .setName(t('settings.extras.telegram.token.name'))
    .setDesc(t('settings.extras.telegram.token.desc'))
    .addText((text) => {
      text.inputEl.type = 'password';
      text.setValue(secrets?.token ?? '');
      text.inputEl.addEventListener('blur', () => {
        const token = text.inputEl.value.trim();
        const current = port.readSecrets();
        if (!token || token === current?.token) return;
        try {
          port.writeSecrets({ token, chatId: current?.chatId ?? null });
        } catch (err) {
          new Notice(errorText(err, token));
          return;
        }
        port.startBridge(true);
        rerender();
      });
    });

  const paired = secrets?.chatId != null;
  const pairSetting = new Setting(container)
    .setName(t('settings.extras.telegram.pair.name'))
    .setDesc(t(paired ? 'settings.extras.telegram.pair.paired' : 'settings.extras.telegram.pair.unpaired'))
    .addButton((button) => {
      button
        .setButtonText(t('settings.extras.telegram.pair.name'))
        .setDisabled(!secrets || busy !== null)
        .onClick(async () => {
          if (port.startBridge(false) !== 'dziala') {
            new Notice(t('settings.extras.telegram.pair.busy'));
            return;
          }
          busy = 'pairing';
          button.setDisabled(true);
          const end = Date.now() + PAIRING_SECONDS * 1000;
          const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
          const tick = (): void => {
            const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
            pairSetting.setDesc(t('settings.extras.telegram.pair.waiting', { s, code }));
          };
          tick();
          const timer = window.setInterval(tick, 1000);
          try {
            const result = await port.startPairing(PAIRING_SECONDS, code);
            if (result === 'sparowano') new Notice(t('settings.extras.telegram.pair.done'));
            else if (result === 'czas-minal') new Notice(t('settings.extras.telegram.pair.timeout'));
          } catch (err) {
            new Notice(errorText(err, secrets?.token));
          } finally {
            window.clearInterval(timer);
            busy = null;
            rerender();
          }
        });
    });

  const voice = settings.voiceName;
  const state = port.toolsState();
  const toolsSetting = new Setting(container).setName(t('settings.extras.telegram.tools.name'));
  let ready = false;

  if (!state.obslugiwane) {
    toolsSetting.setDesc(t('settings.extras.telegram.tools.windowsOnly'));
  } else {
    const tools: Array<[string, string, string | null]> = [
      ['piper', 'Piper', state.piper],
      [voice, voiceLabel(voice), state.glosy[voice] ?? null],
      ['ffmpeg', 'ffmpeg', state.ffmpeg],
    ];
    toolsSetting.setDesc(tools.map(([tool, label, path]) => `${label}: ${toolStatus(tool, path)}`).join(' · '));
    const missing = tools.filter(([, , path]) => !path).map(([tool]) => tool);
    ready = missing.length === 0;

    if (!ready) addInstallButton(toolsSetting, missing, port, rerender);
  }

  new Setting(container)
    .setName(t('settings.extras.telegram.voice.name'))
    .addDropdown((dropdown) => {
      for (const v of port.voices) dropdown.addOption(v, voiceLabel(v));
      dropdown
        .setValue(voice)
        .onChange(async (value) => {
          await plugin.mutateSettings((s) => { s.voiceName = value; });
          rerender();
        });
    });

  renderSpeechRow(container, plugin, port, state, rerender);

  new Setting(container)
    .setName(t('settings.extras.telegram.test.name'))
    .addButton((button) => {
      button
        .setButtonText(t('settings.extras.telegram.test.name'))
        .setDisabled(!paired || !ready || busy !== null)
        .onClick(async () => {
          busy = 'test';
          button.setDisabled(true);
          try {
            port.startBridge(false);
            const ogg = await port.synthesize(t('settings.extras.telegram.test.text'), voice);
            try {
              await port.sendVoice(ogg);
            } finally {
              port.removeFile(ogg);
            }
            new Notice(t('settings.extras.telegram.test.sent'));
          } catch (err) {
            new Notice(errorText(err, secrets?.token));
          } finally {
            busy = null;
            rerender();
          }
        });
    });
}

const toolStatus = (tool: string, path: string | null): string => {
  if (path) return t('settings.extras.telegram.tools.ready');
  return toolErrors.get(tool) ?? t('settings.extras.telegram.tools.missing');
};

/** Instaluje brakujace pozycje po kolei; po instalacji restart mostu, zeby klient dostal nowe narzedzia. */
function addInstallButton(setting: Setting, missing: string[], port: TelegramPanelPort, rerender: () => void): void {
  const total = missing.reduce((sum, tool) => sum + port.toolSize(tool), 0);
  setting.addButton((button: ButtonComponent) => {
    button
      .setButtonText(t('settings.extras.telegram.tools.install', { mb: Math.ceil(total / MB) }))
      .setDisabled(busy !== null)
      .onClick(async () => {
        busy = 'install';
        button.setDisabled(true);
        let before = 0;
        for (const tool of missing) {
          toolErrors.delete(tool);
          try {
            await port.install(tool, (done) => {
              const percent = Math.min(100, Math.floor(((before + done) / total) * 100));
              button.setButtonText(t('settings.extras.telegram.tools.installing', { percent }));
            });
          } catch (err) {
            toolErrors.set(tool, errorText(err));
            new Notice(errorText(err));
          }
          before += port.toolSize(tool);
        }
        busy = null;
        port.startBridge(false);
        rerender();
      });
  });
}

function renderSpeechRow(
  container: HTMLElement,
  plugin: TelegramSettingsHost,
  port: TelegramPanelPort,
  state: VoiceToolsState,
  rerender: () => void,
): void {
  const model = plugin.settings.whisperModel;
  const row = new Setting(container).setName(t('settings.extras.telegram.speech.name'));
  const desc = t('settings.extras.telegram.speech.desc');

  if (!state.obslugiwane) {
    row.setDesc(`${desc} ${t('settings.extras.telegram.tools.windowsOnly')}`);
  } else {
    const modelPath = state.modeleMowy[model] ?? null;
    row.setDesc(`${desc} Whisper: ${toolStatus('whisper', state.whisper)} · ${model}: ${toolStatus(model, modelPath)}`);
    // ffmpeg dzieli z synteza; bez niego transkrypcja nie ruszy, wiec dociagamy go tutaj tez
    const missing = ([['whisper', state.whisper], [model, modelPath], ['ffmpeg', state.ffmpeg]] as const)
      .filter(([, path]) => !path).map(([tool]) => tool);
    if (missing.length > 0) addInstallButton(row, missing, port, rerender);
  }

  row.addDropdown((dropdown) => {
    for (const m of port.speechModels) dropdown.addOption(m, t(`settings.extras.telegram.speech.model.${m}` as TranslationKey));
    dropdown
      .setValue(model)
      .onChange(async (value) => {
        await plugin.mutateSettings((s) => { s.whisperModel = value; });
        rerender();
      });
  });
}
