import { createMockEl } from '@test/helpers/MockElement';
import { setIcon } from 'obsidian';

import { createInputToolbar } from '@/features/chat/ui/InputToolbar';
import { PermissionModeMenu } from '@/features/chat/ui/PermissionModeMenu';
import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn(),
}));

function createCallbacks(permissionMode: string, overrides: Record<string, unknown> = {}) {
  const settings = { model: 'sonnet', thinkingBudget: 'low', effortLevel: 'high', serviceTier: 'default', permissionMode };
  return {
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn().mockResolvedValue(undefined),
    onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
    getSettings: jest.fn(() => settings),
    getUIConfig: jest.fn().mockReturnValue({
      getModelOptions: () => [],
      getReasoningOptions: () => [],
      isAdaptiveReasoningModel: () => true,
      getDefaultReasoningValue: () => 'high',
      getPermissionModeOptions: () => claudeChatUIConfig.getPermissionModeOptions!(),
    }),
    getCapabilities: jest.fn().mockReturnValue({ providerId: 'claude', supportsPlanMode: true }),
    ...overrides,
  } as any;
}

function render(permissionMode: string, overrides: Record<string, unknown> = {}) {
  const parentEl = createMockEl();
  const callbacks = createCallbacks(permissionMode, overrides);
  new PermissionModeMenu(parentEl, callbacks);
  const container = parentEl.querySelector('.claudian-permission-menu')!;
  return {
    callbacks,
    container,
    button: parentEl.querySelector('.claudian-permission-menu-btn')!,
    label: parentEl.querySelector('.claudian-permission-label')!,
    options: parentEl.querySelectorAll('.claudian-permission-menu-option'),
  };
}

function modeValues(options: Array<{ getAttribute(name: string): unknown }>) {
  return options.map(option => option.getAttribute('data-value'));
}

describe('PermissionModeMenu', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders five modes in order, plan last', () => {
    const { options } = render('auto');
    expect(modeValues(options))
      .toEqual(['auto', 'manual', 'acceptEdits', 'yolo', 'plan']);
    expect(options[0].querySelector('.claudian-permission-menu-option-desc')).not.toBeNull();
  });

  it('hides plan without supportsPlanMode', () => {
    const { options } = render('auto', {
      getCapabilities: jest.fn().mockReturnValue({ providerId: 'claude', supportsPlanMode: false }),
    });
    expect(modeValues(options))
      .toEqual(['auto', 'manual', 'acceptEdits', 'yolo']);
  });

  it('marks yolo with the shield icon and alert class', () => {
    const { button, label } = render('yolo');
    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'shield-alert');
    expect(button.hasClass('claudian-permission-menu-btn--alert')).toBe(true);
    expect(label.hasClass('plan-active')).toBe(false);
  });

  it('marks plan with plan-active', () => {
    const { button, label } = render('plan');
    expect(label.hasClass('plan-active')).toBe(true);
    expect(button.hasClass('claudian-permission-menu-btn--alert')).toBe(false);
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('auto has neither marker and an aria-label with the mode', () => {
    const { button, label, options } = render('auto');
    expect(label.hasClass('plan-active')).toBe(false);
    expect(button.hasClass('claudian-permission-menu-btn--alert')).toBe(false);
    expect(setIcon).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-label')).toContain('Auto');
    expect(options[0].hasClass('selected')).toBe(true);
    expect(options[0].getAttribute('aria-checked')).toBe('true');
  });

  it('clicking another mode calls onPermissionModeChange, clicking the current one does nothing', () => {
    const { callbacks, options } = render('auto');
    options[0].click();
    expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();
    options[2].click();
    expect(callbacks.onPermissionModeChange).toHaveBeenCalledWith('acceptEdits');
  });

  it('stays hidden for a provider without the list of modes', () => {
    const { container } = render('normal', {
      getUIConfig: jest.fn().mockReturnValue({ getPermissionModeOptions: undefined }),
    });
    expect(container.hasClass('claudian-hidden')).toBe(true);
  });
});

describe('createInputToolbar permission controls', () => {
  it('toggle provider (Codex) shows the old toggle and hides the menu', () => {
    const parentEl = createMockEl();
    const callbacks = createCallbacks('normal', {
      getUIConfig: jest.fn().mockReturnValue({
        getModelOptions: () => [],
        getReasoningOptions: () => [],
        isAdaptiveReasoningModel: () => true,
        getDefaultReasoningValue: () => 'high',
        getPermissionModeToggle: () => ({
          inactiveValue: 'normal',
          inactiveLabel: 'Safe',
          activeValue: 'yolo',
          activeLabel: 'YOLO',
        }),
      }),
      getCapabilities: jest.fn().mockReturnValue({ providerId: 'codex', supportsPlanMode: false }),
    });
    createInputToolbar(parentEl, callbacks);

    expect(parentEl.querySelector('.claudian-permission-toggle')!.hasClass('claudian-hidden')).toBe(false);
    expect(parentEl.querySelector('.claudian-permission-menu')!.hasClass('claudian-hidden')).toBe(true);
  });

  it('Claude shows the menu and hides the old toggle', () => {
    const parentEl = createMockEl();
    createInputToolbar(parentEl, createCallbacks('auto'));

    expect(parentEl.querySelector('.claudian-permission-toggle')!.hasClass('claudian-hidden')).toBe(true);
    expect(parentEl.querySelector('.claudian-permission-menu')!.hasClass('claudian-hidden')).toBe(false);
  });
});
