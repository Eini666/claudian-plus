import { type ButtonComponent, Notice, Setting } from 'obsidian';

import {
  type ClaudianSettings,
  DEFAULT_ASSISTANT_NAME,
  resolveAssistantName,
} from '../../core/types/settings';
import type { AccountsPanelHost, StanPanelu } from '../../features/accounts/AccountsPanelHost';
import { t } from '../../i18n/i18n';
import { renderTelegramSettingsSection, type TelegramPanelPort } from './TelegramSettingsSection';

interface ExtrasSettingsHost {
  readonly settings: ClaudianSettings;
  readonly accountsPanel: Pick<AccountsPanelHost, 'stan' | 'naZmiane' | 'restart'>;
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

function statusText(stan: StanPanelu, powod: string): string {
  switch (stan) {
    case 'nasz': return t('settings.extras.accountsPanel.status.nasz');
    case 'obcy': return t('settings.extras.accountsPanel.status.obcy');
    case 'wylaczony': return t('settings.extras.accountsPanel.status.wylaczony');
    case 'blad': return t('settings.extras.accountsPanel.status.blad', { reason: powod });
    case 'brak-node': return t('settings.extras.accountsPanel.status.brakNode');
    case 'nielokalny': return t('settings.extras.accountsPanel.status.nielokalny');
  }
}

/** Sekcja jest przebudowywana przy kazdym otwarciu ustawien — nowy render odpina poprzedniego sluchacza. */
let unsubscribeStatus: (() => void) | null = null;

export function renderExtrasSettingsSection(options: ExtrasSettingsSectionOptions): void {
  const { container, plugin, onDesktopAvatarChange, telegram } = options;

  new Setting(container).setName(t('settings.extras.heading')).setHeading();

  // Pola zalezne od przelacznikow zyja we wlasnym kontenerze, zeby przelaczenie odswiezalo tylko sekcje.
  const body = container.createDiv({ cls: 'claudian-extras-settings' });

  const render = (): void => {
    unsubscribeStatus?.();
    unsubscribeStatus = null;
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

      // mutateSettings sam woła accountsPanel.odswiez()
      new Setting(body)
        .setName(t('settings.extras.accountsPanel.managed.name'))
        .setDesc(t('settings.extras.accountsPanel.managed.desc'))
        .addToggle((toggle) => {
          toggle
            .setValue(settings.accountsPanelManaged)
            .onChange((value) => save((s) => { s.accountsPanelManaged = value; }, true));
        });

      const panel = plugin.accountsPanel;
      let restartButton: ButtonComponent | null = null;
      const statusSetting = new Setting(body)
        .setName(t('settings.extras.accountsPanel.status.name'))
        .addButton((button) => {
          button
            .setButtonText(t('settings.extras.accountsPanel.open'))
            .onClick(() => { window.open(plugin.settings.accountsPanelUrl); });
        })
        .addButton((button) => {
          restartButton = button;
          button
            .setButtonText(t('settings.extras.accountsPanel.restart'))
            .onClick(async () => {
              button.setDisabled(true);
              await panel.restart();
              // Ten sam stan po restarcie nie wywola zdarzenia — odblokuj przycisk recznie
              showStatus(panel.stan.stan, panel.stan.powod);
            });
        });

      const showStatus = (stan: StanPanelu, powod: string): void => {
        statusSetting.setDesc(statusText(stan, powod));
        restartButton?.setDisabled(!plugin.settings.accountsPanelManaged || (stan !== 'nasz' && stan !== 'blad'));
      };
      showStatus(panel.stan.stan, panel.stan.powod);
      unsubscribeStatus = panel.naZmiane(showStatus);
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
