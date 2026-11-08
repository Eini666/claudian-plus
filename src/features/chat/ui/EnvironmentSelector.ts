/**
 * Panel „Środowisko" w pasku kompozytora — co Claude Code wciąga do sesji
 * i szybkie wyłączniki tego, czego akurat nie chcesz.
 *
 * Czemu tutaj, a nie w ustawieniach wtyczki: ustawienia otwiera się raz na miesiąc,
 * a pytanie „co jest teraz włączone" pada w trakcie rozmowy (użytkownik, 17.09.2026).
 *
 * Przełączniki piszą do plików konfiguracji Claude Code, więc działają też w CLI —
 * ale dopiero od NASTĘPNEJ sesji: SDK czyta konfigurację przy starcie procesu.
 */

import type { App } from 'obsidian';
import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { getVaultPath } from '../../../utils/path';
import {
  type EnvironmentState,
  readEnvironmentState,
  setHooksDisabled,
  setMcpServerEnabled,
  setOutputStyle,
  setPluginEnabled,
  type ToggleItem,
} from '../environment/environmentConfig';

export class EnvironmentSelector {
  private readonly container: HTMLElement;
  private readonly buttonEl: HTMLElement;
  private panel: HTMLElement | null = null;
  private removeOutsideClick: (() => void) | null = null;
  private state: EnvironmentState | null = null;
  private open = false;

  constructor(parentEl: HTMLElement, private readonly app: App) {
    this.container = parentEl.createDiv({ cls: 'claudian-env-selector' });
    this.buttonEl = this.container.createDiv({ cls: 'claudian-env-button' });
    setIcon(this.buttonEl.createSpan({ cls: 'claudian-env-icon' }), 'sliders-horizontal');
    this.container.setAttribute('title', t('environmentPanel.title'));

    this.buttonEl.addEventListener('click', () => {
      void this.toggleOpen();
    });
  }

  /**
   * Panel powstaje przy pierwszym otwarciu, nie z każdą kartą: wcześniej każda karta
   * dokładała element na body i nasłuch na dokumencie (a test kart padał bez `document`).
   */
  private get panelEl(): HTMLElement {
    if (this.panel) return this.panel;
    // Dokument okna z przyciskiem — rozmowa bywa wyrwana do osobnego okna Obsidiana.
    const doc = this.container.ownerDocument ?? activeDocument;
    // Panel wisi na BODY, nie w pasku: pasek kompozytora ma własne `overflow`,
    // więc panel wpięty w niego był przycinany do szerokości przycisku — zostawał
    // słupek checkboxów bez etykiet (zobaczone na zrzucie 18.09).
    const panel = doc.body.createDiv({ cls: 'claudian-env-panel claudian-hidden' });
    // Klik poza panelem zamyka — bez tego panel zostaje otwarty nad polem wpisywania.
    const onOutsideClick = (event: MouseEvent): void => {
      if (!this.open) return;
      const target = event.target as Node;
      if (this.container.contains(target) || panel.contains(target)) return;
      this.setOpen(false);
    };
    doc.addEventListener('click', onOutsideClick);
    this.removeOutsideClick = () => doc.removeEventListener('click', onOutsideClick);
    this.panel = panel;
    return panel;
  }

  /** Nad przyciskiem, a gdy brakuje miejsca u góry — pod nim. Zawsze w oknie. */
  private position(): void {
    const button = this.buttonEl.getBoundingClientRect();
    const margin = 8;
    const width = this.panelEl.offsetWidth;
    const height = this.panelEl.offsetHeight;
    const viewportWidth = activeWindow.innerWidth;
    const viewportHeight = activeWindow.innerHeight;

    const left = Math.max(margin, Math.min(button.left, viewportWidth - width - margin));
    const above = button.top - height - 6;
    const top = above >= margin ? above : Math.min(button.bottom + 6, viewportHeight - height - margin);

    this.panelEl.style.left = `${left}px`;
    this.panelEl.style.top = `${Math.max(margin, top)}px`;
  }

  private async toggleOpen(): Promise<void> {
    if (this.open) {
      this.setOpen(false);
      return;
    }
    this.setOpen(true);
    await this.refresh();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.panelEl.toggleClass('claudian-hidden', !open);
    this.buttonEl.toggleClass('active', open);
    if (open) this.position();
  }

  /** Panel żyje na body — bez tego zostaje po zamknięciu karty rozmowy. */
  destroy(): void {
    this.removeOutsideClick?.();
    this.removeOutsideClick = null;
    this.panel?.remove();
    this.panel = null;
  }

  private async refresh(): Promise<void> {
    this.panelEl.empty();
    this.panelEl.createDiv({
      cls: 'claudian-env-note',
      text: t('environmentPanel.loading'),
    });
    this.state = await readEnvironmentState(getVaultPath(this.app));
    this.render();
    // Dopiero teraz panel zna swoją wysokość — przed odczytem miał jedną linijkę.
    this.position();
  }

  private render(): void {
    const state = this.state;
    if (!state) return;

    this.panelEl.empty();
    this.panelEl.createDiv({ cls: 'claudian-env-note', text: t('environmentPanel.appliesNext') });

    this.renderToggleSection(
      t('environmentPanel.mcp'),
      state.mcpServers,
      async (item, enabled) => {
        await setMcpServerEnabled(state, item, enabled);
      },
    );

    this.renderToggleSection(
      t('environmentPanel.plugins'),
      state.plugins,
      async (item, enabled) => {
        await setPluginEnabled(state.configDir, item.id, enabled);
      },
    );

    this.renderSectionHeader(t('environmentPanel.hooks'));
    this.renderToggleRow(
      {
        id: 'hooks',
        label: t('environmentPanel.hooksEnabled'),
        detail: 'disableAllHooks',
        enabled: !state.hooksDisabled,
        scope: 'user',
      },
      async (_item, enabled) => {
        await setHooksDisabled(state.configDir, !enabled);
      },
    );

    this.renderOutputStyle(state);
    this.renderSkills(state);
  }

  private renderSectionHeader(title: string): void {
    this.panelEl.createDiv({ cls: 'claudian-env-section', text: title });
  }

  private renderToggleSection(
    title: string,
    items: ToggleItem[],
    apply: (item: ToggleItem, enabled: boolean) => Promise<void>,
  ): void {
    this.renderSectionHeader(title);
    if (items.length === 0) {
      this.panelEl.createDiv({ cls: 'claudian-env-note', text: t('environmentPanel.none') });
      return;
    }
    for (const item of items) {
      this.renderToggleRow(item, apply);
    }
  }

  private renderToggleRow(
    item: ToggleItem,
    apply: (item: ToggleItem, enabled: boolean) => Promise<void>,
  ): void {
    const row = this.panelEl.createEl('label', { cls: 'claudian-env-row' });
    const checkbox = row.createEl('input', { type: 'checkbox' });
    checkbox.checked = item.enabled;
    const text = row.createDiv({ cls: 'claudian-env-row-text' });
    text.createDiv({ cls: 'claudian-env-row-label', text: item.label });
    text.createDiv({ cls: 'claudian-env-row-detail', text: item.detail });

    checkbox.addEventListener('change', () => {
      const enabled = checkbox.checked;
      // Blokada na czas zapisu: dwa kliknięcia pod rząd potrafią przepleść zapisy
      // tego samego pliku i drugi nadpisze stan z pierwszego.
      checkbox.disabled = true;
      void apply(item, enabled)
        .then(() => {
          item.enabled = enabled;
        })
        .catch(() => {
          checkbox.checked = item.enabled;
        })
        .finally(() => {
          checkbox.disabled = false;
        });
    });
  }

  private renderOutputStyle(state: EnvironmentState): void {
    this.renderSectionHeader(t('environmentPanel.outputStyle'));
    const row = this.panelEl.createDiv({ cls: 'claudian-env-row' });
    const select = row.createEl('select', { cls: 'claudian-env-select' });
    select.createEl('option', { text: t('environmentPanel.default'), value: '' });
    for (const style of state.outputStyles) {
      select.createEl('option', { text: style, value: style });
    }
    select.value = state.outputStyle ?? '';
    select.addEventListener('change', () => {
      const value = select.value === '' ? null : select.value;
      select.disabled = true;
      void setOutputStyle(state.configDir, value)
        .then(() => {
          state.outputStyle = value;
        })
        .catch(() => {
          select.value = state.outputStyle ?? '';
        })
        .finally(() => {
          select.disabled = false;
        });
    });
  }

  /**
   * Skille są tu tylko do odczytu: ani `settings.json`, ani `.claude.json` nie mają
   * pola „wyłączony skill" — SDK potrafi to wyłącznie per sesja (opcja `skills`),
   * a panel pisze do plików. Lista i tak mówi, co model widzi.
   */
  private renderSkills(state: EnvironmentState): void {
    this.renderSectionHeader(t('environmentPanel.skills'));
    if (state.skills.length === 0) {
      this.panelEl.createDiv({ cls: 'claudian-env-note', text: t('environmentPanel.none') });
      return;
    }
    this.panelEl.createDiv({
      cls: 'claudian-env-note',
      text: `${state.skills.length} · ${t('environmentPanel.skillsReadOnly')}`,
    });
    this.panelEl.createDiv({ cls: 'claudian-env-skills', text: state.skills.join(', ') });
  }
}
