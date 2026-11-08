import { Notice, Setting } from 'obsidian';

import {
  type ClaudianSettings,
  DEFAULT_ASSISTANT_NAME,
  resolveAssistantName,
} from '../../core/types/settings';
import { t } from '../../i18n/i18n';
import { renderTelegramSettingsSection, type TelegramPanelPort } from './TelegramSettingsSection';

interface ExtrasSettingsHost {
  readonly settings: ClaudianSettings;
  mutateSettings(mutation: (settings: ClaudianSettings) => void | Promise<void>): Promise<void>;
}

interface ExtrasSettingsSectionOptions {
  container: HTMLElement;
  plugin: ExtrasSettingsHost;
  /** Wlacza/wylacza plywajace okno od razu, bez ponownego otwierania karty. */
  onDesktopAvatarChange?: (enabled: boolean) => void;
  telegram: TelegramPanelPort;
}

function isPanelUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export function renderExtrasSettingsSection(options: ExtrasSettingsSectionOptions): void {
  const { container, plugin, onDesktopAvatarChange, telegram } = options;

  new Setting(container).setName(t('settings.extras.heading')).setHeading();

  // Pola zalezne od przelacznikow zyja we wlasnym kontenerze, zeby przelaczenie odswiezalo tylko sekcje.
  const body = container.createDiv({ cls: 'claudian-extras-settings' });

  const render = (): void => {
    body.empty();
    const settings = plugin.settings;

    const save = (mutation: (s: ClaudianSettings) => void, rerender = false): Promise<void> =>
      plugin.mutateSettings(mutation).then(() => {
        if (rerender) render();
      });

    new Setting(body)
      .setName(t('settings.extras.assistantName.name'))
      .setDesc(t('settings.extras.assistantName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_ASSISTANT_NAME)
          .setValue(settings.assistantName)
          .onChange((value) => save((s) => { s.assistantName = resolveAssistantName(value); }));
      });

    new Setting(body)
      .setName(t('settings.extras.showAvatarBadge.name'))
      .setDesc(t('settings.extras.showAvatarBadge.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(settings.showAvatarBadge)
          .onChange((value) => save((s) => { s.showAvatarBadge = value; }));
      });

    new Setting(body)
      .setName(t('settings.extras.showAriWidget.name'))
      .setDesc(t('settings.extras.showAriWidget.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(settings.showAriWidget)
          .onChange(async (value) => {
            await save((s) => { s.showAriWidget = value; });
            onDesktopAvatarChange?.(value);
          });
      });

    new Setting(body)
      .setName(t('settings.extras.accountSwitcher.name'))
      .setDesc(t('settings.extras.accountSwitcher.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(settings.accountSwitcherEnabled)
          .onChange((value) => save((s) => { s.accountSwitcherEnabled = value; }, true));
      });

    if (settings.accountSwitcherEnabled) {
      new Setting(body)
        .setName(t('settings.extras.accountsPanelUrl.name'))
        .addText((text) => {
          text.setValue(settings.accountsPanelUrl);
          text.inputEl.addEventListener('blur', () => {
            const value = text.inputEl.value.trim();
            if (value === plugin.settings.accountsPanelUrl) return;
            if (!isPanelUrl(value)) {
              new Notice(t('settings.extras.accountsPanelUrl.invalid'));
              text.setValue(plugin.settings.accountsPanelUrl);
              return;
            }
            void save((s) => { s.accountsPanelUrl = value; });
          });
        });
    }

    new Setting(body)
      .setName(t('settings.extras.telegramBridge.name'))
      .setDesc(t('settings.extras.telegramBridge.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(settings.telegramBridgeEnabled)
          .onChange((value) => save((s) => { s.telegramBridgeEnabled = value; }, true));
      });

    if (settings.telegramBridgeEnabled) {
      renderTelegramSettingsSection({ container: body, plugin, port: telegram, rerender: render });
    }
  };

  render();
}
