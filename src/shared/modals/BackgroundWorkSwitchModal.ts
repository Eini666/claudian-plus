import { type App, Modal, Setting } from 'obsidian';

import { t } from '../../i18n/i18n';

/** Przełączenie rozmowy w karcie zamyka jej proces CLI, a z nim zadania w tle. */
export type BackgroundWorkSwitchChoice = 'new-tab' | 'switch';

export function chooseBackgroundWorkSwitch(
  app: App,
  canOpenNewTab: boolean,
): Promise<BackgroundWorkSwitchChoice | null> {
  return new Promise(resolve => {
    new BackgroundWorkSwitchModal(app, canOpenNewTab, resolve).open();
  });
}

class BackgroundWorkSwitchModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly canOpenNewTab: boolean,
    private readonly resolve: (choice: BackgroundWorkSwitchChoice | null) => void,
  ) {
    super(app);
  }

  onOpen() {
    this.setTitle(t('chat.backgroundSwitch.title'));
    this.modalEl.addClass('claudian-confirm-modal');
    this.contentEl.createEl('p', { text: t('chat.backgroundSwitch.message') });

    const buttons = new Setting(this.contentEl)
      .addButton(btn => btn
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText(t('chat.backgroundSwitch.switchAnyway'))
        .setDestructive()
        .onClick(() => this.choose('switch')));
    if (this.canOpenNewTab) {
      buttons.addButton(btn => btn
        .setButtonText(t('chat.backgroundSwitch.openNewTab'))
        .setCta()
        .onClick(() => this.choose('new-tab')));
    }
  }

  private choose(choice: BackgroundWorkSwitchChoice): void {
    this.resolved = true;
    this.resolve(choice);
    this.close();
  }

  onClose() {
    if (!this.resolved) this.resolve(null);
    this.contentEl.empty();
  }
}
