import * as fs from 'fs';
import type { App } from 'obsidian';
import { Menu, Notice, setIcon } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import type { PlanRateLimits, PlanRateLimitWindow, UsageInfo } from '../../../core/types';
import { resolveAssistantName } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import {
  accountShortLabel,
  describePanelUsage,
  describeSwitchCost,
  fetchPanelAccounts,
  type PanelAccount,
  panelUsageToPlanLimits,
  switchPanelAccount,
} from '../../../utils/accountsPanel';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { describeCacheWarmth, type TurnStamp } from '../../../utils/CacheWarmth';
import {
  bumpAccountGeneration,
  forCurrentAccount,
  getCurrentAccountEmail,
  getCurrentAccountId,
} from '../../../utils/claudeAccount';
import { filterValidPaths, findConflictingPath, isDuplicatePath, isValidDirectoryPath, validateDirectoryPath } from '../../../utils/externalContext';
import { expandHomePath, normalizePathForFilesystem } from '../../../utils/path';
import { toggleServiceTier } from '../actions/toggleServiceTier';
import { type AriLook, lookForSignal } from '../services/AriAvatar';
import { type MountedRobot, mountRobot } from '../services/ariRobot';
import { flagaPozaDomem, folderMostu } from '../services/ariTelefon';
import { getAriWidget } from '../services/AriWidget';
import { subscribeTurn } from '../services/TurnNotifier';
import { EnvironmentSelector } from './EnvironmentSelector';
import { ModelThinkingPanel } from './ModelThinkingPanel';
import { PermissionModeMenu } from './PermissionModeMenu';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: {
      properties: string[];
      title: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<ElectronOpenDialogResult>;
  };
}

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  lastPlanRateLimits?: PlanRateLimits | null;
  telegramBridgeEnabled?: boolean;
  telegramBridgeDir?: string;
  showAvatarBadge?: boolean;
  accountSwitcherEnabled?: boolean;
  accountsPanelUrl?: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onServiceTierChange: (serviceTier: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ProviderChatUIConfig;
  getCapabilities: () => ProviderCapabilities;
  /** Zwraca liczbe obsluzonych plikow; brak = przycisk sie nie pokazuje. */
  onPickFiles?: (filePaths: string[]) => Promise<number>;
  /** Limity konta po przelaczeniu — do zapamietania, zeby pasek przezyl ponowne otwarcie. */
  onAccountLimits?: (limits: PlanRateLimits) => void;
  /** Plywajace okno z awatarem: odczyt stanu i przelaczenie (ustawienia trzyma wtyczka). */
  getAriWidgetEnabled?: () => boolean;
  onAriWidgetToggle?: () => Promise<void>;
  /** Panel „Środowisko" czyta konfigurację z dysku — potrzebuje ścieżki vaulta. */
  getApp?: () => App;
}

/**
 * Awatar stanu Ari w pasku kompozytora — zarazem przelacznik plywajacego okna.
 * Stoi tutaj, a nie w rzedzie nad polem wpisywania, bo tamten rzad znika w calosci
 * w szerokim ukladzie z panelem sesji (`.claudian-wide-session-layout`), a stan Ari
 * ma byc widoczny zawsze (zlapane na zywo 13.09).
 */
export class AriAvatarBadge {
  private container: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private robot: MountedRobot | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'claudian-ari-avatar' });
    this.container.setAttribute('role', 'button');
    this.container.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to toggle the desktop avatar');
    });
    this.unsubscribe = subscribeTurn(signal => this.paint(lookForSignal(signal)));
    this.updateDisplay();
  }

  /** Robot powstaje raz; kolejne sygnaly tylko zmieniaja mu stan (przejscie z glitchem). */
  private paint(look: AriLook): void {
    if (this.robot) {
      this.robot.set(look);
      return;
    }
    // Awatar jest ozdoba: brak canvasu (atrapy DOM w testach) nie moze wywrocic paska.
    try {
      this.robot = mountRobot(this.container, this.container.createEl('canvas'), look, { size: 20, antenna: false, floorShadow: false });
    } catch {
      this.robot = null;
    }
  }

  private async toggle(): Promise<void> {
    await this.callbacks.onAriWidgetToggle?.();
    this.updateDisplay();
  }

  updateDisplay(): void {
    const enabled = this.callbacks.getAriWidgetEnabled?.() === true;
    this.container.toggleClass('claudian-ari-widget-on', enabled);
    this.container.setAttribute(
      'aria-label',
      enabled ? 'Hide the desktop avatar' : 'Show the desktop avatar',
    );
    getAriWidget()?.setEnabled(enabled);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.robot?.destroy();
    this.robot = null;
  }
}

export class ModeSelector {
  private container: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private toggleEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-mode-selector' });
    this.render();
  }

  private getSelectorConfig(): ProviderModeSelectorConfig | null {
    return this.callbacks.getUIConfig().getModeSelector?.(this.callbacks.getSettings()) ?? null;
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'claudian-mode-label' });
    this.toggleEl = this.container.createDiv({ cls: 'claudian-toggle-switch' });

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change mode');
    });

    this.updateDisplay();
  }

  /** Resolves the active/inactive option pair for a two-option toggle. */
  private resolveOptionPair(
    selectorConfig: ProviderModeSelectorConfig,
  ): { active: ProviderUIOption; inactive: ProviderUIOption } {
    const [first, second] = selectorConfig.options;
    const active = selectorConfig.activeValue
      ? selectorConfig.options.find((option) => option.value === selectorConfig.activeValue) ?? second
      : second;
    const inactive = active.value === first.value ? second : first;
    return { active, inactive };
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) {
      return;
    }

    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const currentOption = selectorConfig.options.find((option) => option.value === selectorConfig.value)
      ?? selectorConfig.options[0];
    const isActive = currentOption.value === active.value;

    this.labelEl.setText(currentOption.label || selectorConfig.label);
    this.labelEl.toggleClass('active', isActive);
    if (isActive) {
      this.toggleEl.addClass('active');
    } else {
      this.toggleEl.removeClass('active');
    }

    const titleParts = [`${inactive.label} <-> ${active.label}`];
    if (currentOption.description) {
      titleParts.push(currentOption.description);
    }
    this.container.setAttribute('title', titleParts.join('\n'));
  }

  renderOptions() {
    this.updateDisplay();
  }

  private async toggle() {
    const selectorConfig = this.getSelectorConfig();
    if (!selectorConfig || selectorConfig.options.length !== 2) {
      return;
    }

    const { active, inactive } = this.resolveOptionPair(selectorConfig);
    const nextValue = selectorConfig.value === active.value ? inactive.value : active.value;
    await this.callbacks.onModeChange(nextValue);
    this.updateDisplay();
  }
}

export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private visible = true;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-permission-toggle' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'claudian-permission-label' });
    this.toggleEl = this.container.createDiv({ cls: 'claudian-toggle-switch' });

    this.updateDisplay();

    this.toggleEl.addEventListener('click', () => {
      runToolbarAction(() => this.toggle(), 'Failed to change permission mode');
    });
  }

  private getToggleConfig(): ProviderPermissionModeToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getPermissionModeToggle?.() ?? null;
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    const toggleConfig = this.getToggleConfig();
    const capabilities = this.callbacks.getCapabilities();
    if (!this.visible || !toggleConfig) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    const planValue = toggleConfig.planValue;
    const planLabel = toggleConfig.planLabel ?? 'PLAN';
    const canShowPlan = Boolean(planValue) && capabilities.supportsPlanMode;

    if (canShowPlan && planValue && mode === planValue) {
      this.toggleEl.addClass('claudian-hidden');
      this.labelEl.setText(planLabel);
      this.labelEl.addClass('plan-active');
    } else {
      this.toggleEl.removeClass('claudian-hidden');
      this.labelEl.removeClass('plan-active');
      if (mode === toggleConfig.activeValue) {
        this.toggleEl.addClass('active');
        this.labelEl.setText(toggleConfig.activeLabel);
      } else {
        this.toggleEl.removeClass('active');
        this.labelEl.setText(toggleConfig.inactiveLabel);
      }
    }
  }

  private async toggle() {
    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) return;

    const current = this.callbacks.getSettings().permissionMode;
    const newMode = current === toggleConfig.activeValue
      ? toggleConfig.inactiveValue
      : toggleConfig.activeValue;
    await this.callbacks.onPermissionModeChange(newMode);
    this.updateDisplay();
  }
}

/**
 * „Poza domem" — czy Ari ma raportować etapy głosówkami na Telegram.
 *
 * Stan to jeden plik-flaga w folderze mostu z ustawień. Czytają go trzy strony: ten
 * przełącznik, program mostu (komendy „wychodzę"/„wróciłem" z telefonu) i jego nadawca
 * głosówek, który bez flagi nic nie wysyła. Dlatego przełącznik nie trzyma stanu u siebie, tylko odświeża
 * się z pliku — zmiana z telefonu ma być tu widoczna.
 */
export class AwayToggle {
  private readonly toggleEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly flaga: string;
  private readonly intervalId: number;

  constructor(parentEl: HTMLElement, bridgeDir: string, assistantName?: unknown) {
    this.flaga = flagaPozaDomem(bridgeDir);
    const container = parentEl.createDiv({ cls: 'claudian-permission-toggle claudian-away-toggle' });
    container.setAttr(
      'title',
      `Poza domem: ${resolveAssistantName(assistantName)} wysyła głosówki na Telegram po każdym etapie`,
    );
    this.labelEl = container.createSpan({ cls: 'claudian-permission-label' });
    this.toggleEl = container.createDiv({ cls: 'claudian-toggle-switch' });
    this.toggleEl.addEventListener('click', () => {
      try {
        if (fs.existsSync(this.flaga)) fs.unlinkSync(this.flaga);
        else fs.writeFileSync(this.flaga, new Date().toISOString());
      } catch (e) {
        new Notice(`Nie przełączyłam trybu: ${(e as Error).message}`);
      }
      this.updateDisplay();
    });
    this.updateDisplay();
    this.intervalId = window.setInterval(() => this.updateDisplay(), 5000);
  }

  updateDisplay(): void {
    const away = fs.existsSync(this.flaga);
    this.toggleEl.toggleClass('active', away);
    this.labelEl.setText(away ? 'POZA DOMEM' : 'W DOMU');
  }

  destroy(): void {
    window.clearInterval(this.intervalId);
  }
}

export class ServiceTierToggle {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-service-tier-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'claudian-service-tier-button' });
    this.iconEl = this.buttonEl.createSpan({ cls: 'claudian-service-tier-icon' });
    setIcon(this.iconEl, 'zap');

    this.updateDisplay();

    this.buttonEl.addEventListener('click', () => {
      runToolbarAction(async () => {
        await this.toggle();
      }, 'Failed to change service tier');
    });
  }

  private getToggleConfig(): ProviderServiceTierToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getServiceTierToggle?.(this.callbacks.getSettings()) ?? null;
  }

  updateDisplay() {
    if (!this.buttonEl || !this.iconEl) return;

    const toggleConfig = this.getToggleConfig();
    if (!toggleConfig) {
      this.container.addClass('claudian-hidden');
      return;
    }

    this.container.removeClass('claudian-hidden');
    if (toggleConfig.isActive) {
      this.buttonEl.addClass('active');
    } else {
      this.buttonEl.removeClass('active');
    }

    const currentLabel = toggleConfig.isActive
      ? toggleConfig.activeLabel
      : toggleConfig.inactiveLabel;
    this.container.setAttribute('title', `Fast mode: ${currentLabel}`);
  }

  async toggle(): Promise<boolean> {
    const toggled = await toggleServiceTier(this.callbacks);
    if (toggled) {
      this.updateDisplay();
    }
    return toggled;
  }
}

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

export class ExternalContextSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /**
   * Current external context paths. May contain:
   * - Persistent paths only (new sessions via clearExternalContexts)
   * - Restored session paths (loaded sessions via setExternalContexts)
   * - Mixed paths during active sessions
   */
  private externalContextPaths: string[] = [];
  /** Paths that persist across all sessions (stored in settings). */
  private persistentPaths: Set<string> = new Set();
  private onChangeCallback: ((paths: string[]) => void) | null = null;
  private onPersistenceChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'claudian-external-context-selector' });
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  setOnPersistenceChange(callback: (paths: string[]) => void): void {
    this.onPersistenceChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  getPersistentPaths(): string[] {
    return [...this.persistentPaths];
  }

  setPersistentPaths(paths: string[]): void {
    // Validate paths - remove non-existent directories
    const validPaths = filterValidPaths(paths);
    const invalidPaths = paths.filter(p => !validPaths.includes(p));

    this.persistentPaths = new Set(validPaths);
    // Merge persistent paths into external context paths
    this.mergePersistentPaths();
    this.updateDisplay();
    this.renderDropdown();

    // If invalid paths were removed, notify user and save updated list
    if (invalidPaths.length > 0) {
      const pathNames = invalidPaths.map(p => this.shortenPath(p)).join(', ');
      new Notice(`Removed ${invalidPaths.length} invalid external context path(s): ${pathNames}`, 5000);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
  }

  togglePersistence(path: string): void {
    if (this.persistentPaths.has(path)) {
      this.persistentPaths.delete(path);
    } else {
      // Validate path still exists before persisting
      if (!isValidDirectoryPath(path)) {
        new Notice(`Cannot persist "${this.shortenPath(path)}" - directory no longer exists`, 4000);
        return;
      }
      this.persistentPaths.add(path);
    }
    this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    this.renderDropdown();
  }

  private mergePersistentPaths(): void {
    const pathSet = new Set(this.externalContextPaths);
    for (const path of this.persistentPaths) {
      pathSet.add(path);
    }
    this.externalContextPaths = [...pathSet];
  }

  /**
   * Restore exact external context paths from a saved conversation.
   * Does NOT merge with persistent paths - preserves the session's historical state.
   * Use clearExternalContexts() for new sessions to start with current persistent paths.
   */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Remove a path from external contexts (and persistent paths if applicable).
   * Exposed for testing the remove button behavior.
   */
  removePath(pathStr: string): void {
    this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
    // Also remove from persistent paths if it was persistent
    if (this.persistentPaths.has(pathStr)) {
      this.persistentPaths.delete(pathStr);
      this.onPersistenceChangeCallback?.([...this.persistentPaths]);
    }
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Add an external context path programmatically (e.g., from /add-dir command).
   * Validates the path and handles duplicates/conflicts.
   * @param pathInput - Path string (supports ~/ expansion)
   * @returns Result with success status and normalized path, or error message on failure
   */
  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: 'No path provided. Usage: /add-dir /absolute/path' };
    }

    // Strip surrounding quotes if present (e.g., "/path/with spaces")
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    // Expand home directory and normalize path
    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: 'Path must be absolute. Usage: /add-dir /absolute/path' };
    }

    // Validate path exists and is a directory with specific error messages
    const validation = validateDirectoryPath(normalizedPath);
    if (!validation.valid) {
      return { success: false, error: `${validation.error}: ${pathInput}` };
    }

    // Check for duplicate (normalized comparison for cross-platform support)
    if (isDuplicatePath(normalizedPath, this.externalContextPaths)) {
      return { success: false, error: 'This folder is already added as an external context.' };
    }

    // Check for nested/overlapping paths
    const conflict = findConflictingPath(normalizedPath, this.externalContextPaths);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    // Add the path
    this.externalContextPaths = [...this.externalContextPaths, normalizedPath];
    this.onChangeCallback?.(this.externalContextPaths);
    this.updateDisplay();
    this.renderDropdown();

    return { success: true, normalizedPath };
  }

  /**
   * Clear session-only external context paths (call on new conversation).
   * Uses persistent paths from settings if provided, otherwise falls back to local cache.
   * Validates paths before using them (silently filters invalid during session init).
   */
  clearExternalContexts(persistentPathsFromSettings?: string[]): void {
    // Use settings value if provided (most up-to-date), otherwise use local cache
    if (persistentPathsFromSettings) {
      // Validate paths - silently filter during session initialization (not user action)
      const validPaths = filterValidPaths(persistentPathsFromSettings);
      this.persistentPaths = new Set(validPaths);
    }
    this.externalContextPaths = [...this.persistentPaths];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'claudian-external-context-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'claudian-external-context-icon' });
    setIcon(this.iconEl, 'folder');

    this.badgeEl = iconWrapper.createDiv({ cls: 'claudian-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    iconWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'claudian-external-context-dropdown' });
    this.renderDropdown();
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
      const { remote } = require('electron') as { remote?: ElectronRemoteApi };
      if (!remote) {
        throw new Error('Electron remote API is unavailable');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select External Context',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate (normalized comparison for cross-platform support)
        if (isDuplicatePath(selectedPath, this.externalContextPaths)) {
          new Notice('This folder is already added as an external context.', 3000);
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          new Notice(this.formatConflictMessage(selectedPath, conflict), 5000);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch {
      new Notice('Unable to open folder picker.', 5000);
    }
  }

  /** Formats a conflict error message for display. */
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`
      : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'claudian-external-context-header' });
    headerEl.setText('External contexts');

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'claudian-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'claudian-external-context-empty' });
      emptyEl.setText('Click folder icon to add');
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'claudian-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'claudian-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        // Lock toggle button
        const isPersistent = this.persistentPaths.has(pathStr);
        const lockBtn = itemEl.createSpan({ cls: 'claudian-external-context-lock' });
        if (isPersistent) {
          lockBtn.addClass('locked');
        }
        setIcon(lockBtn, isPersistent ? 'lock' : 'unlock');
        lockBtn.setAttribute('title', isPersistent ? 'Persistent (click to make session-only)' : 'Session-only (click to persist)');
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePersistence(pathStr);
        });

        const removeBtn = itemEl.createSpan({ cls: 'claudian-external-context-remove' });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Remove path');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removePath(pathStr);
        });
      }
    }
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        // Use normalized path length and normalize the result for consistent display
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''} (click to add more)`);

      // Show badge only when more than 1 path
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Add external contexts (click)');
      this.badgeEl.removeClass('visible');
    }
  }
}

type PlanLimitRowKey = 'fiveHour' | 'sevenDay' | 'context';

/** 750000 → "750k"; ten sam ksztalt co w tooltipie licznika kontekstu. */
function formatTokensShort(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

/**
 * Zalaczanie obrazow z dysku przez natywne okno wyboru.
 * Bez tego jedyna droga do pliku spoza skarbca bylo przeciagniecie go na okno,
 * co wymaga minimalizowania Obsidiana i celowania w ikone na pasku zadan.
 */
export class ImagePickerButton {
  private container: HTMLElement;

  constructor(parentEl: HTMLElement, private readonly callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'claudian-image-picker' });
    this.container.setAttribute('aria-label', t('chat.ui.attachImage'));
    this.container.setAttribute('role', 'button');
    this.container.setAttribute('tabindex', '0');
    setIcon(this.container, 'image-plus');

    if (!callbacks.onPickFiles) {
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.addEventListener('click', (event) => {
      event.stopPropagation();
      runToolbarAction(() => this.openPicker(), t('chat.ui.attachImageFailed'));
    });
  }

  private async openPicker(): Promise<void> {
    const pick = this.callbacks.onPickFiles;
    if (!pick) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
    const { remote } = require('electron') as { remote?: ElectronRemoteApi };
    if (!remote) throw new Error('Electron remote API is unavailable');

    const result = await remote.dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: t('chat.ui.attachImage'),
      filters: [
        { name: t('chat.ui.attachFilterImages'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: t('chat.ui.attachFilterAll'), extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    const added = await pick(result.filePaths);
    if (added === 0) return;
    new Notice(t('chat.ui.attachImageDone', { count: added }), 2000);
  }

  destroy(): void {
    this.container.remove();
  }
}

/**
 * Limity planu (5h / 7d) obok licznika kontekstu.
 * Procent i czas do resetu widoczne bez najezdzania — „widze i wiem”.
 */
export class PlanLimitsMeter {
  private container: HTMLElement;
  private rows = new Map<PlanLimitRowKey, { fill: HTMLElement; text: HTMLElement }>();
  private tickHandle: number | null = null;
  private lastLimits: PlanRateLimits | null = null;
  // Rozmiar kontekstu potrzebny plakietce kont — to on wyznacza koszt przelaczenia.
  private lastContextTokens = 0;

  constructor(parentEl: HTMLElement, callbacks?: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'claudian-plan-limits' });
    this.addRow('fiveHour', '5h');
    this.addRow('sevenDay', '7d');
    this.addRow('context', 'ctx');
    this.container.addClass('claudian-hidden');
    // Pasek nie moze byc pusty do pierwszej wymiany — pokazujemy ostatnie znane.
    const remembered = forCurrentAccount(callbacks?.getSettings().lastPlanRateLimits);
    if (remembered) this.update(remembered);
  }

  private addRow(key: PlanLimitRowKey, label: string): void {
    const row = this.container.createDiv({ cls: 'claudian-plan-limit' });
    row.createSpan({ cls: 'claudian-plan-limit-label', text: label });
    const track = row.createDiv({ cls: 'claudian-plan-limit-track' });
    const fill = track.createDiv({ cls: 'claudian-plan-limit-fill' });
    const text = row.createSpan({ cls: 'claudian-plan-limit-text' });
    this.rows.set(key, { fill, text });
  }

  /** „4h 37m” albo „2d 5h” — im dalej reset, tym grubsza jednostka. */
  private formatReset(resetsAt: number | null): string {
    if (!resetsAt) return '';
    const left = resetsAt - Math.floor(Date.now() / 1000);
    if (left <= 0) return 'teraz';
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  /** Okno po `resetsAt` wyzerowalo sie — stary procent bylby klamstwem. */
  private prune(limits: PlanRateLimits | null): PlanRateLimits | null {
    if (!limits) return null;
    const now = Math.floor(Date.now() / 1000);
    const fresh = (w?: PlanRateLimitWindow) => (w && (w.resetsAt === null || w.resetsAt > now) ? w : undefined);
    const fiveHour = fresh(limits.fiveHour);
    const sevenDay = fresh(limits.sevenDay);
    if (!fiveHour && !sevenDay) return null;
    return {
      ...(fiveHour ? { fiveHour } : {}),
      ...(sevenDay ? { sevenDay } : {}),
      ...(limits.status ? { status: limits.status } : {}),
    };
  }

  update(raw: PlanRateLimits | null): void {
    const limits = this.prune(raw);
    this.lastLimits = limits;
    if (!limits || (!limits.fiveHour && !limits.sevenDay)) {
      for (const key of ['fiveHour', 'sevenDay'] as const) {
        this.rows.get(key)?.fill.parentElement?.parentElement?.addClass('claudian-hidden');
      }
      this.refreshVisibility();
      this.stopTicking();
      return;
    }
    this.container.removeClass('claudian-hidden');
    this.container.toggleClass('claudian-plan-limits-warning', limits.status === 'allowed_warning');
    this.container.toggleClass('claudian-plan-limits-rejected', limits.status === 'rejected');

    for (const [key, row] of this.rows) {
      if (key === 'context') continue;
      const window = limits[key];
      if (!window) {
        row.fill.parentElement?.parentElement?.addClass('claudian-hidden');
        continue;
      }
      row.fill.parentElement?.parentElement?.removeClass('claudian-hidden');
      row.fill.style.width = `${window.percentage}%`;
      row.fill.toggleClass('claudian-plan-limit-high', window.percentage >= 80);
      const reset = this.formatReset(window.resetsAt);
      row.text.setText(reset ? `${window.percentage}% · ${reset}` : `${window.percentage}%`);
    }

    this.startTicking();
  }

  /**
   * Kontekst rysowany tym samym paskiem co limity planu, na koncu rzedu:
   * 5h → 7d → ctx. Zastepuje osobny okrag, ktory mial inny jezyk wizualny.
   */
  updateContext(usage: UsageInfo | null): void {
    const row = this.rows.get('context');
    if (!row) return;
    const rowEl = row.fill.parentElement?.parentElement;
    if (!usage || usage.contextTokens <= 0 || usage.contextWindow <= 0) {
      this.lastContextTokens = 0;
      rowEl?.addClass('claudian-hidden');
      this.refreshVisibility();
      return;
    }
    this.lastContextTokens = usage.contextTokens;
    rowEl?.removeClass('claudian-hidden');
    row.fill.style.width = `${usage.percentage}%`;
    row.fill.toggleClass('claudian-plan-limit-high', usage.percentage >= 80);
    const left = Math.max(0, usage.contextWindow - usage.contextTokens);
    row.text.setText(`${usage.percentage}% · ${formatTokensShort(left)} zostalo`);
    this.container.removeClass('claudian-hidden');
  }

  /** Ile tokenow niesie rozmowa — plakietka kont liczy z tego koszt przelaczenia. */
  getContextTokens(): number {
    return this.lastContextTokens;
  }

  /** Chowa caly pasek dopiero, gdy zaden z trzech wierszy nie ma danych. */
  private refreshVisibility(): void {
    const anyVisible = Array.from(this.rows.values()).some(
      row => !row.fill.parentElement?.parentElement?.hasClass('claudian-hidden'),
    );
    this.container.toggleClass('claudian-hidden', !anyVisible);
  }

  /** Odswieza sam czas do resetu co minute — procent przyjdzie z SDK. */
  private startTicking(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = window.setInterval(() => {
      if (this.lastLimits) this.update(this.lastLimits);
    }, 60_000);
  }

  private stopTicking(): void {
    if (this.tickHandle === null) return;
    window.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  destroy(): void {
    this.stopTicking();
    this.container.remove();
  }
}

/**
 * Pigulka ciepla cache TEJ rozmowy: na ktorym koncie zyje i ile minut jeszcze.
 * Osobna od plakietki kont — mowi o rozmowie, nie o koncie. Logika w `CacheWarmth.ts`.
 */
export class CacheWarmthPill {
  private el: HTMLElement;
  private iconEl: HTMLElement;
  private labelEl: HTMLElement;
  private tickHandle: number | null = null;
  private stamp: TurnStamp | null = null;
  private contextTokens = 0;
  private lastIcon = '';

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createDiv({ cls: 'claudian-cache-pill claudian-hidden' });
    this.iconEl = this.el.createSpan({ cls: 'claudian-cache-pill-icon' });
    this.labelEl = this.el.createSpan();
  }

  update(usage: UsageInfo | null, stamp: TurnStamp | null): void {
    this.stamp = stamp;
    this.contextTokens = usage?.contextTokens ?? 0;
    this.render();
  }

  private render(): void {
    const w = describeCacheWarmth(this.stamp, this.contextTokens, getCurrentAccountId(), getCurrentAccountEmail());
    if (!w) {
      this.el.addClass('claudian-hidden');
      this.stopTicking();
      return;
    }
    this.el.removeClass('claudian-hidden');
    const icon = w.tone === 'cold' ? 'snowflake' : 'flame';
    if (icon !== this.lastIcon) {
      this.iconEl.empty();
      setIcon(this.iconEl, icon);
      this.lastIcon = icon;
    }
    this.labelEl.setText(w.label);
    this.el.setAttr('title', w.tooltip);
    for (const tone of ['warm', 'mismatch', 'unknown', 'cold']) {
      this.el.toggleClass(`is-${tone}`, w.tone === tone);
    }
    // Zimna juz sie nie zmieni sama; ciepla odlicza minuty i pilnuje przelaczenia konta.
    if (w.tone === 'cold') this.stopTicking();
    else this.startTicking();
  }

  // ponytail: co 20 s, bo konto przelacza sie tez poza wtyczka (panel, auto-switch); sam stat pliku
  private startTicking(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = window.setInterval(() => this.render(), 20_000);
  }

  private stopTicking(): void {
    if (this.tickHandle === null) return;
    window.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  destroy(): void {
    this.stopTicking();
    this.el.remove();
  }
}

// Plakietka zyje w kazdej karcie — bez tego naprawe ogloszloby tyle okienek, ile kart.
let announcedRepairAt = 0;

/**
 * Panel kont naprawil rozjazd: plik tozsamosci mowil jedno konto, a zapytania szly
 * tokenem drugiego (24.09 przez 5 h bez zadnego sygnalu). Mowimy o tym glosno, bo to
 * znaczy, ze limit schodzil z innego konta, niz pokazywala plakietka.
 */
function announceRepair(repaired: { at: number; from: string; to: string }): void {
  if (repaired.at <= announcedRepairAt) return;
  announcedRepairAt = repaired.at;
  new Notice(
    `⚠ Konto: plakietka pokazywała ${accountShortLabel(repaired.from)}, a zapytania szły z `
    + `${accountShortLabel(repaired.to)}. Panel kont to naprawił — zużycie liczy się na ${accountShortLabel(repaired.to)}.`,
    15_000,
  );
}

/**
 * Plakietka aktywnego konta obok paska limitow + menu przelaczania.
 * Samo przelaczenie i limity kont robi lokalny panel kont — patrz `accountsPanel.ts`.
 */
export class AccountSwitcher {
  private buttonEl: HTMLElement;
  private labelEl: HTMLElement;
  private pollHandle: number | null = null;
  private lastAccountId: string | null;
  private busy = false;

  constructor(
    parentEl: HTMLElement,
    private readonly panelUrl: string,
    private readonly onLimits: (limits: PlanRateLimits | null) => void,
    private readonly getContextTokens: () => number = () => 0,
  ) {
    this.buttonEl = parentEl.createDiv({
      cls: 'claudian-account-switcher',
      attr: { role: 'button', tabindex: '0', 'aria-label': 'Przełącz konto Claude' },
    });
    this.labelEl = this.buttonEl.createSpan({ cls: 'claudian-account-label' });
    setIcon(this.buttonEl.createSpan({ cls: 'claudian-account-chevron' }), 'chevron-down');
    this.lastAccountId = getCurrentAccountId();
    this.refreshLabel();

    this.buttonEl.addEventListener('click', (event) => void this.openMenu(event));
    this.buttonEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void this.openMenu(null);
    });
    // Konto zmienia sie tez poza wtyczka: panel w Pulsie, auto-switch przy 90%.
    // ponytail: odpytywanie co 15 s (sam stat pliku); watcher gdy to kiedys zamuli
    this.pollHandle = window.setInterval(() => void this.syncAfterExternalSwitch(), 15_000);
  }

  private refreshLabel(): void {
    const email = getCurrentAccountEmail();
    this.labelEl.setText(accountShortLabel(email));
    this.buttonEl.setAttr('title', email ?? 'Nie wiem, jakie konto jest aktywne');
  }

  private async openMenu(event: MouseEvent | null): Promise<void> {
    if (this.busy) return;
    const accounts = await fetchPanelAccounts(this.panelUrl);
    if (!accounts) {
      new Notice(`Panel kont nie odpowiada na ${this.panelUrl} — przełączanie kont niedostępne.`);
      return;
    }

    const menu = new Menu();
    for (const account of accounts) {
      // Koszt dotyczy tylko przejscia GDZIE INDZIEJ — klik w aktywne konto nic nie robi.
      const koszt = account.active ? null : describeSwitchCost(this.getContextTokens());
      menu.addItem(item => item
        .setTitle(`${accountShortLabel(account.email)}  —  ${describePanelUsage(account)}`
          + (koszt ? `  ·  ${koszt}` : ''))
        .setChecked(account.active)
        .onClick(() => void this.switchTo(account)));
    }
    if (event) {
      menu.showAtMouseEvent(event);
    } else {
      const rect = this.buttonEl.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
  }

  private async switchTo(account: PanelAccount): Promise<void> {
    if (account.active || this.busy) return;
    this.busy = true;
    this.buttonEl.addClass('is-busy');
    try {
      await switchPanelAccount(this.panelUrl, account.name);
      bumpAccountGeneration();
      this.lastAccountId = getCurrentAccountId();
      this.refreshLabel();
      // Limity konta docelowego sa w panelu juz teraz — nie czekamy na pierwsza odpowiedz.
      this.onLimits(panelUsageToPlanLimits(account, this.lastAccountId));
      new Notice(`Konto: ${accountShortLabel(account.email)}`);
    } catch (error) {
      new Notice(`Nie przełączyło konta: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      this.buttonEl.removeClass('is-busy');
    }
  }

  private async syncAfterExternalSwitch(): Promise<void> {
    const accountId = getCurrentAccountId();
    if (this.busy || accountId === this.lastAccountId) return;
    this.lastAccountId = accountId;
    // Konto zmienione poza ta karta (panel, auto-switch, naprawa rozjazdu) — procesy
    // kart musza wystartowac od nowa, inaczej wpisza stara tozsamosc z powrotem.
    bumpAccountGeneration();
    this.refreshLabel();
    const active = (await fetchPanelAccounts(this.panelUrl))?.find(account => account.active);
    if (active?.repaired) announceRepair(active.repaired);
    // Bez panelu nie znamy liczb nowego konta — pusty pasek zamiast cudzych.
    this.onLimits(active ? panelUsageToPlanLimits(active, accountId) : null);
  }

  destroy(): void {
    if (this.pollHandle !== null) window.clearInterval(this.pollHandle);
    this.pollHandle = null;
    this.buttonEl.remove();
  }
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'claudian-context-meter' });
    this.container.setAttribute('role', 'progressbar');
    this.container.setAttribute('aria-label', 'Context usage');
    this.container.setAttribute('aria-valuemin', '0');
    this.container.setAttribute('aria-valuemax', '100');
    this.render();
    // Initially hidden
    this.container.addClass('claudian-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('claudian-hidden', !visible);
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'claudian-context-meter-gauge' });
    const svg = gaugeEl.createSvg('svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;
    const backgroundPath = svg.createSvg('path');
    backgroundPath.classList.add('claudian-meter-bg');
    backgroundPath.setAttribute('d', pathData);
    backgroundPath.setAttribute('fill', 'none');
    backgroundPath.setAttribute('stroke-width', String(strokeWidth));
    backgroundPath.setAttribute('stroke-linecap', 'round');

    const fillPath = svg.createSvg('path');
    fillPath.classList.add('claudian-meter-fill');
    fillPath.setAttribute('d', pathData);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke-width', String(strokeWidth));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('stroke-dasharray', String(this.circumference));
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.appendChild(backgroundPath);
    svg.appendChild(fillPath);
    gaugeEl.appendChild(svg);
    this.fillPath = fillPath;

    this.percentEl = this.container.createSpan({ cls: 'claudian-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      this.container.addClass('claudian-hidden');
      return;
    }
    this.container.removeClass('claudian-hidden');
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
    }

    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    // Set tooltip with detailed usage
    let tooltip = `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`;
    if (usage.percentage > 80) {
      tooltip += ' (Approaching limit, run `/compact` to continue)';
    }
    this.container.setAttribute('data-tooltip', tooltip);
    this.container.setAttribute('aria-valuenow', String(usage.percentage));
    this.container.setAttribute(
      'aria-valuetext',
      `${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`,
    );
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}

const TOOLBAR_COMPACT_CLASS = 'claudian-input-toolbar--compact';
const ROW_CENTER_TOLERANCE = 1;

/** Hides optional labels only when the full toolbar would wrap. */
export class InputToolbarLayoutController {
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private pendingLayout: ScheduledAnimationFrame | null = null;

  constructor(private readonly toolbarEl: HTMLElement) {
    try {
      this.observeLayoutChanges();
      this.scheduleLayout();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  refreshLayout(): void {
    this.toolbarEl.classList.remove(TOOLBAR_COMPACT_CLASS);
    this.toolbarEl.classList.toggle(TOOLBAR_COMPACT_CLASS, this.hasWrappedItems());
  }

  destroy(): void {
    if (this.pendingLayout !== null) {
      cancelScheduledAnimationFrame(this.pendingLayout);
      this.pendingLayout = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  private hasWrappedItems(): boolean {
    const rowCenters = Array.from(this.toolbarEl.children)
      .map((item) => item.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.top + rect.height / 2);
    const firstRowCenter = rowCenters[0];
    if (firstRowCenter === undefined) return false;

    return rowCenters.some((center) => Math.abs(center - firstRowCenter) > ROW_CENTER_TOLERANCE);
  }

  private scheduleLayout(): void {
    if (this.pendingLayout !== null) {
      cancelScheduledAnimationFrame(this.pendingLayout);
    }
    this.pendingLayout = scheduleAnimationFrame(() => {
      this.pendingLayout = null;
      this.refreshLayout();
    }, this.toolbarEl.ownerDocument.defaultView);
  }

  private observeLayoutChanges(): void {
    const ownerWindow = this.toolbarEl.ownerDocument.defaultView;
    const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
    if (typeof ResizeObserverConstructor === 'function') {
      this.resizeObserver = new ResizeObserverConstructor(() => this.scheduleLayout());
      this.resizeObserver.observe(this.toolbarEl);
    }

    const MutationObserverConstructor = ownerWindow?.MutationObserver;
    if (typeof MutationObserverConstructor !== 'function') return;

    this.mutationObserver = new MutationObserverConstructor((mutations) => {
      const hasContentChange = mutations.some((mutation) => (
        mutation.type !== 'attributes'
        || mutation.target !== this.toolbarEl
        || mutation.attributeName !== 'class'
      ));
      if (hasContentChange) {
        this.scheduleLayout();
      }
    });
    this.mutationObserver.observe(this.toolbarEl, {
      attributes: true,
      attributeFilter: ['class'],
      characterData: true,
      childList: true,
      subtree: true,
    });
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelThinkingPanel;
  modeSelector: ModeSelector;
  thinkingBudgetSelector: ModelThinkingPanel;
  contextUsageMeter: ContextUsageMeter;
  planLimitsMeter: PlanLimitsMeter;
  cacheWarmthPill: CacheWarmthPill;
  accountSwitcher: AccountSwitcher | null;
  layoutController: InputToolbarLayoutController;
  externalContextSelector: ExternalContextSelector;
  imagePickerButton: ImagePickerButton;
  permissionToggle: PermissionToggle;
  permissionModeMenu: PermissionModeMenu;
  serviceTierToggle: ServiceTierToggle;
  ariAvatarBadge: AriAvatarBadge | null;
  awayToggle: AwayToggle | null;
  environmentSelector: EnvironmentSelector | null;
} {
  // Opcje paska czytane raz przy tworzeniu karty — zmiana dziala po ponownym otwarciu karty.
  const settings = callbacks.getSettings();
  // Pierwszy w rzedzie — stan Ari ma byc najbardziej na wierzchu.
  const ariAvatarBadge = settings.showAvatarBadge !== false ? new AriAvatarBadge(parentEl, callbacks) : null;
  // Bez plakietki nikt inny nie przywraca okna awatara po starcie.
  if (!ariAvatarBadge) getAriWidget()?.setEnabled(callbacks.getAriWidgetEnabled?.() === true);
  // Jeden panel obsluguje model i poziom myslenia; oba pola karty wskazuja na ten sam obiekt.
  const modelSelector = new ModelThinkingPanel(parentEl, callbacks);
  const serviceTierToggle = new ServiceTierToggle(parentEl, callbacks);
  // Okrag kontekstu zostaje w kodzie (klasa upstreamu), ale nie dostaje juz danych —
  // kontekst rysuje trzeci pasek w PlanLimitsMeter, zeby caly rzad mial jeden jezyk
  // wizualny: 5h → 7d → ctx. Konstruktor chowa okrag, wiec nic nie widac.
  const contextUsageMeter = new ContextUsageMeter(parentEl);
  const planLimitsMeter = new PlanLimitsMeter(parentEl, callbacks);
  const cacheWarmthPill = new CacheWarmthPill(parentEl);
  const accountSwitcher = settings.accountSwitcherEnabled === true && settings.accountsPanelUrl
    ? new AccountSwitcher(parentEl, settings.accountsPanelUrl, (limits) => {
      planLimitsMeter.update(limits);
      if (limits) callbacks.onAccountLimits?.(limits);
    }, () => planLimitsMeter.getContextTokens())
    : null;
  const externalContextSelector = new ExternalContextSelector(parentEl, callbacks);
  const imagePickerButton = new ImagePickerButton(parentEl, callbacks);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);
  // Obie kontrolki trybu stoja w pasku; kazda chowa sie, gdy provider karty jej nie obsluguje.
  const permissionModeMenu = new PermissionModeMenu(parentEl, callbacks);
  // Most wyłączony albo bez folderu = brak przełącznika.
  const bridgeDir = folderMostu(settings);
  const awayToggle = bridgeDir ? new AwayToggle(parentEl, bridgeDir, settings.assistantName) : null;
  const app = callbacks.getApp?.();
  const environmentSelector = app ? new EnvironmentSelector(parentEl, app) : null;
  const modeSelector = new ModeSelector(parentEl, callbacks);
  const layoutController = new InputToolbarLayoutController(parentEl);

  return {
    ariAvatarBadge,
    modelSelector,
    modeSelector,
    thinkingBudgetSelector: modelSelector,
    serviceTierToggle,
    contextUsageMeter,
    planLimitsMeter,
    cacheWarmthPill,
    accountSwitcher,
    layoutController,
    externalContextSelector,
    imagePickerButton,
    permissionToggle,
    permissionModeMenu,
    awayToggle,
    environmentSelector,
  };
}
