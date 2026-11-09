import { Notice, setIcon } from 'obsidian';

import type { ProviderPermissionModeOption } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import type { ToolbarCallbacks } from './InputToolbar';

const PLAN_MODE = 'plan';

/** Wspólny kontrakt kontrolki trybu w pasku (stary przełącznik i menu). */
export interface PermissionModeControl {
  setVisible(visible: boolean): void;
  updateDisplay(): void;
}

/** Karta trzyma obie kontrolki, bo provider może się w niej zmienić; każda chowa się sama, gdy provider jej nie obsługuje. */
export function combinePermissionControls(...controls: PermissionModeControl[]): PermissionModeControl {
  return {
    setVisible: (visible) => controls.forEach(control => control.setVisible(visible)),
    updateDisplay: () => controls.forEach(control => control.updateDisplay()),
  };
}

/** Menu trybów uprawnień dla providerów z listą opcji (`getPermissionModeOptions`). */
export class PermissionModeMenu implements PermissionModeControl {
  private readonly container: HTMLElement;
  private readonly buttonEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly dropdownEl: HTMLElement;
  private readonly callbacks: ToolbarCallbacks;
  private visible = true;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-permission-menu' });
    this.buttonEl = this.container.createDiv({ cls: 'claudian-permission-menu-btn' });
    this.buttonEl.setAttribute('role', 'button');
    this.buttonEl.setAttribute('aria-haspopup', 'menu');
    this.buttonEl.setAttribute('tabindex', '0');
    this.iconEl = this.buttonEl.createSpan({ cls: 'claudian-permission-menu-icon' });
    this.labelEl = this.buttonEl.createSpan({ cls: 'claudian-permission-label' });
    this.dropdownEl = this.container.createDiv({ cls: 'claudian-permission-menu-dropdown' });
    this.dropdownEl.setAttribute('role', 'menu');
    this.dropdownEl.setAttribute('aria-label', t('chat.permissionMode.label'));
    this.container.addEventListener('mouseenter', () => this.updateDisplay());
    this.updateDisplay();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private getOptions(): readonly ProviderPermissionModeOption[] {
    const options = this.callbacks.getUIConfig().getPermissionModeOptions?.(this.callbacks.getSettings()) ?? [];
    const supportsPlan = this.callbacks.getCapabilities().supportsPlanMode;
    return options.filter(option => supportsPlan || option.value !== PLAN_MODE);
  }

  updateDisplay(): void {
    const options = this.getOptions();
    if (!this.visible || options.length === 0) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    // Projekcja ustawień normalizuje tryb; pierwsza opcja pokrywa tylko chwilowy rozjazd.
    const current = options.find(option => option.value === mode) ?? options[0];
    const bypasses = current.bypassesApprovals === true;

    this.labelEl.setText(current.label);
    this.labelEl.toggleClass('plan-active', current.value === PLAN_MODE);
    this.iconEl.empty();
    this.iconEl.toggleClass('claudian-hidden', !bypasses);
    if (bypasses) setIcon(this.iconEl, 'shield-alert');
    this.buttonEl.toggleClass('claudian-permission-menu-btn--alert', bypasses);
    this.buttonEl.setAttribute('aria-label', t('chat.permissionMode.current', { mode: current.label }));

    this.renderOptions(options, current.value);
  }

  private renderOptions(options: readonly ProviderPermissionModeOption[], currentValue: string): void {
    this.dropdownEl.empty();
    for (const choice of options) {
      const isCurrent = choice.value === currentValue;
      const item = this.dropdownEl.createDiv({ cls: 'claudian-permission-menu-option' });
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(isCurrent));
      item.setAttribute('data-value', choice.value);
      if (isCurrent) item.addClass('selected');
      if (choice.bypassesApprovals) item.addClass('claudian-permission-menu-option--alert');
      item.createDiv({ cls: 'claudian-permission-menu-option-label', text: choice.label });
      if (choice.description) {
        item.createDiv({ cls: 'claudian-permission-menu-option-desc', text: choice.description });
      }

      item.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        if (choice.value === this.callbacks.getSettings().permissionMode) return;
        void this.callbacks.onPermissionModeChange(choice.value)
          .catch(() => new Notice(t('chat.permissionMode.changeFailed')))
          .finally(() => this.updateDisplay());
      });
    }
  }
}
