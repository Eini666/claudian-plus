import { Notice, setIcon } from 'obsidian';

import type { ProviderReasoningOption } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { createProviderIconSvg } from '../../../shared/icons';
import type { ToolbarCallbacks } from './InputToolbar';

// Kopia z InputToolbar.ts: import wartości stamtąd zrobiłby cykl, gdy toolbar zacznie importować panel.
function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

interface ReasoningState {
  adaptive: boolean;
  options: ProviderReasoningOption[];
  current: string;
}

/** Jeden chip „Model · Poziom” w pasku + panel z kolumną modeli i kolumną poziomów myślenia. */
export class ModelThinkingPanel {
  private readonly container: HTMLElement;
  private readonly buttonEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly providerEl: HTMLElement;
  private readonly modelsEl: HTMLElement;
  private readonly levelsEl: HTMLElement;
  private readonly callbacks: ToolbarCallbacks;
  private open = false;

  private readonly onDocumentClick = (event: Event): void => {
    const target = event.target as Node | null;
    if (target && this.container.contains(target)) return;
    this.close();
  };

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.close();
    this.buttonEl.focus();
  };

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-model-selector' });
    this.buttonEl = this.container.createDiv({ cls: 'claudian-model-btn' });
    this.buttonEl.setAttribute('role', 'button');
    this.buttonEl.setAttribute('tabindex', '0');
    this.buttonEl.setAttribute('aria-haspopup', 'dialog');
    this.buttonEl.setAttribute('aria-expanded', 'false');
    this.buttonEl.setAttribute('aria-label', t('chat.modelPanel.open'));
    onActivate(this.buttonEl, () => this.toggle());

    this.panelEl = this.container.createDiv({ cls: 'claudian-model-panel claudian-hidden' });
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-label', t('chat.modelPanel.open'));
    // Pasek dostawcy jak w upstreamie; u nas tylko bieżący dostawca, bez przełączania.
    this.providerEl = this.panelEl.createDiv({ cls: 'claudian-model-panel-provider' });
    this.modelsEl = this.panelEl.createDiv({ cls: 'claudian-model-panel-column claudian-model-panel-models' });
    this.levelsEl = this.panelEl.createDiv({ cls: 'claudian-model-panel-column claudian-model-panel-levels' });

    this.updateDisplay();
    this.renderModels();
  }

  private getAvailableModels() {
    const settings = this.callbacks.getSettings();
    return this.callbacks.getUIConfig().getModelOptions({
      ...settings,
      environmentVariables: this.callbacks.getEnvironmentVariables?.(),
    });
  }

  /** Logika ukrywania 1:1 z dawnego `ThinkingBudgetSelector.updateDisplay`; null = brak wyboru poziomu. */
  private getReasoningState(): ReasoningState | null {
    if (this.callbacks.getCapabilities().reasoningControl === 'none') return null;

    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const uiConfig = this.callbacks.getUIConfig();
    const options = uiConfig.getReasoningOptions(model, settings);
    const defaultValue = uiConfig.getDefaultReasoningValue(model, settings);
    if (options.length === 0 || (options.length === 1 && options[0]?.value === defaultValue)) return null;

    const adaptive = uiConfig.isAdaptiveReasoningModel(model, settings);
    return { adaptive, options, current: adaptive ? settings.effortLevel : settings.thinkingBudget };
  }

  updateDisplay(): void {
    const models = this.getAvailableModels();
    const currentModel = this.callbacks.getSettings().model;
    const displayModel = models.find(m => m.value === currentModel) ?? models[0];
    const icon = displayModel?.providerIcon ?? this.callbacks.getUIConfig().getProviderIcon?.();
    const reasoning = this.getReasoningState();

    this.buttonEl.empty();
    if (icon) {
      createProviderIconSvg(icon, {
        className: 'claudian-model-provider-icon',
        height: 12,
        parent: this.buttonEl,
        width: 12,
      });
    }
    this.buttonEl.createSpan({ cls: 'claudian-model-label', text: displayModel?.label || 'Unknown' });
    if (reasoning) {
      const level = reasoning.options.find(o => o.value === reasoning.current) ?? reasoning.options[0];
      this.buttonEl.createSpan({ cls: 'claudian-model-level', text: ` · ${level.label}` });
    }
    setIcon(this.buttonEl.createSpan({ cls: 'claudian-model-chevron' }), 'chevron-up');

    this.providerEl.empty();
    const providerIcon = this.callbacks.getUIConfig().getProviderIcon?.();
    if (providerIcon) {
      createProviderIconSvg(providerIcon, {
        className: 'claudian-model-provider-icon',
        height: 14,
        parent: this.providerEl.createDiv({ cls: 'claudian-model-panel-provider-item' }),
        width: 14,
      });
    }
    this.providerEl.toggleClass('claudian-hidden', !providerIcon);

    this.renderLevels(reasoning);
  }

  renderOptions(): void {
    this.renderModels();
    this.renderLevels(this.getReasoningState());
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.panelEl.addClass('claudian-hidden');
    this.buttonEl.setAttribute('aria-expanded', 'false');
    const doc = this.container.ownerDocument;
    doc.removeEventListener('click', this.onDocumentClick);
    doc.removeEventListener('keydown', this.onDocumentKeydown);
  }

  private toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    this.open = true;
    this.updateDisplay();
    this.renderModels();
    this.panelEl.removeClass('claudian-hidden');
    this.buttonEl.setAttribute('aria-expanded', 'true');
    const doc = this.container.ownerDocument;
    doc.addEventListener('click', this.onDocumentClick);
    doc.addEventListener('keydown', this.onDocumentKeydown);
  }

  private renderModels(): void {
    this.modelsEl.empty();
    this.modelsEl.createDiv({ cls: 'claudian-model-panel-heading', text: t('chat.modelPanel.model') });
    const listEl = this.modelsEl.createDiv({ cls: 'claudian-model-panel-list' });

    const currentModel = this.callbacks.getSettings().model;
    let lastGroup: string | undefined;
    // Od najlżejszego do najcięższego, jak w upstreamie (panel nie jest już listą rozwijaną w górę).
    for (const model of this.getAvailableModels()) {
      if (model.group && model.group !== lastGroup) {
        listEl.createDiv({ cls: 'claudian-model-group', text: model.group });
        lastGroup = model.group;
      }

      const selected = model.value === currentModel;
      const row = listEl.createDiv({ cls: 'claudian-model-panel-row' });
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-pressed', String(selected));
      row.setAttribute('data-value', model.value);
      if (selected) row.addClass('selected');

      const nameEl = row.createDiv({ cls: 'claudian-model-panel-name' });
      if (model.providerIcon) {
        createProviderIconSvg(model.providerIcon, {
          className: 'claudian-model-provider-icon',
          height: 12,
          parent: nameEl,
          width: 12,
        });
      }
      nameEl.createSpan({ cls: 'claudian-model-panel-label', text: model.label });
      if (selected) nameEl.createSpan({ cls: 'claudian-model-panel-check', text: '✓' });
      if (model.description) {
        row.createDiv({ cls: 'claudian-model-panel-desc', text: model.description });
        row.setAttribute('title', model.description);
      }

      onActivate(row, () => {
        runToolbarAction(async () => {
          await this.callbacks.onModelChange(model.value);
          this.updateDisplay();
          this.renderModels();
        }, 'Failed to change model');
      });
    }
  }

  private renderLevels(reasoning: ReasoningState | null): void {
    this.levelsEl.empty();
    this.levelsEl.toggleClass('claudian-hidden', !reasoning);
    if (!reasoning) return;

    const { adaptive, options, current } = reasoning;
    this.levelsEl.createDiv({
      cls: 'claudian-model-panel-heading',
      text: t(adaptive ? 'chat.modelPanel.effort' : 'chat.modelPanel.budget'),
    });
    const listEl = this.levelsEl.createDiv({ cls: 'claudian-model-panel-list' });

    const ordered = [...options].reverse();
    ordered.forEach((option, index) => {
      const selected = option.value === current;
      const row = listEl.createDiv({ cls: 'claudian-model-panel-level' });
      // Kreski siły: najgłębszy poziom ma wszystkie, każdy kolejny o jedną mniej (min. jedna).
      const strength = Math.max(1, Math.round((STRENGTH_BARS * (ordered.length - index)) / ordered.length));
      const barsEl = row.createSpan({ cls: 'claudian-model-panel-bars' });
      barsEl.setAttribute('aria-hidden', 'true');
      for (let bar = 1; bar <= STRENGTH_BARS; bar++) {
        barsEl.createSpan({ cls: bar <= strength ? 'claudian-model-panel-bar is-on' : 'claudian-model-panel-bar' });
      }
      row.createSpan({ cls: 'claudian-model-panel-level-label', text: option.label });
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-pressed', String(selected));
      row.setAttribute('data-value', option.value);
      if (selected) row.addClass('selected');
      const tokens = option.tokens ?? 0;
      const title = option.description
        ?? (adaptive ? undefined : tokens > 0 ? `${tokens.toLocaleString()} tokens` : 'Disabled');
      if (title) row.setAttribute('title', title);

      onActivate(row, () => {
        runToolbarAction(async () => {
          if (adaptive) await this.callbacks.onEffortLevelChange(option.value);
          else await this.callbacks.onThinkingBudgetChange(option.value);
          this.updateDisplay();
          this.close();
        }, adaptive ? 'Failed to change effort level' : 'Failed to change thinking budget');
      });
    });
  }
}

const STRENGTH_BARS = 4;

/** Klik albo Enter/Spacja; stopPropagation, bo przerysowany wiersz wypada z DOM i klik w dokumencie zamknąłby panel. */
function onActivate(el: HTMLElement, action: () => void): void {
  el.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    action();
  });
  el.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  });
}
