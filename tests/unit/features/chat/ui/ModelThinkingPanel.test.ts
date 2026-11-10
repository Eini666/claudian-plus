import { createMockEl } from '@test/helpers/MockElement';

import { ModelThinkingPanel } from '@/features/chat/ui/ModelThinkingPanel';
import { setLocale } from '@/i18n/i18n';

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  setIcon: jest.fn(),
}));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const EFFORT = [
  { value: 'low', label: 'Low', description: 'Fastest' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const BUDGET = [
  { value: 'off', label: 'Off', tokens: 0 },
  { value: 'low', label: 'Low', tokens: 4000 },
  { value: 'high', label: 'High', tokens: 16000 },
];
const MODELS = [
  { value: 'haiku', label: 'Haiku', description: 'Fast' },
  { value: 'opus', label: 'Opus', description: 'Most capable' },
  { value: 'gpt', label: 'GPT', group: 'Codex', providerIcon: { viewBox: '0 0 1 1', path: 'M0 0' } },
];

function setup(overrides: { adaptive?: boolean; reasoningControl?: string; model?: string } = {}) {
  const settings = {
    model: overrides.model ?? 'opus',
    thinkingBudget: 'low',
    effortLevel: 'medium',
    serviceTier: 'default',
    permissionMode: 'auto',
  };
  const adaptive = overrides.adaptive ?? true;
  const callbacks = {
    onModelChange: jest.fn(async (model: string) => { settings.model = model; }),
    onModeChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn(async (budget: string) => { settings.thinkingBudget = budget; }),
    onEffortLevelChange: jest.fn(async (effort: string) => { settings.effortLevel = effort; }),
    onServiceTierChange: jest.fn().mockResolvedValue(undefined),
    onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
    getSettings: jest.fn(() => settings),
    getUIConfig: jest.fn().mockReturnValue({
      getModelOptions: jest.fn(() => MODELS),
      getReasoningOptions: jest.fn((model: string) => (model === 'haiku' ? BUDGET : adaptive ? EFFORT : BUDGET)),
      isAdaptiveReasoningModel: jest.fn((model: string) => model !== 'haiku' && adaptive),
      getDefaultReasoningValue: () => 'high',
    }),
    getCapabilities: jest.fn().mockReturnValue({ providerId: 'claude', reasoningControl: overrides.reasoningControl ?? 'effort' }),
  } as any;

  const parentEl = createMockEl();
  const panel = new ModelThinkingPanel(parentEl, callbacks);
  const q = (cls: string) => parentEl.querySelector(cls);
  const button = q('.claudian-model-btn');
  const chipText = () => button.children.map((c: any) => c.textContent).join('');
  const isOpen = () => button.getAttribute('aria-expanded') === 'true';
  const levels = () => parentEl.querySelectorAll('.claudian-model-panel-level');
  const rows = () => parentEl.querySelectorAll('.claudian-model-panel-row');
  return { panel, parentEl, callbacks, settings, q, button, chipText, isOpen, levels, rows };
}

describe('ModelThinkingPanel', () => {
  let doc: any;

  beforeEach(() => {
    jest.clearAllMocks();
    setLocale('pl');
    doc = createMockEl();
    (globalThis as any).document = doc;
  });

  afterEach(() => {
    delete (globalThis as any).document;
    setLocale('en');
  });

  it('chip shows model and level for an adaptive model', () => {
    const { chipText, button } = setup();
    expect(chipText()).toBe('Opus · Medium');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-label')).toBe('Model i myślenie');
  });

  it('chip shows the model alone and hides the levels column without reasoning control', () => {
    const { chipText, q } = setup({ reasoningControl: 'none' });
    expect(chipText()).toBe('Opus');
    expect(chipText()).not.toContain(' · ');
    expect(q('.claudian-model-panel-levels').hasClass('claudian-hidden')).toBe(true);
  });

  it('click toggles the panel; Escape and an outside click close it; a click inside does not', () => {
    const { button, isOpen, q } = setup();
    const panelEl = q('.claudian-model-panel');
    expect(isOpen()).toBe(false);
    expect(panelEl.hasClass('claudian-hidden')).toBe(true);

    button.click();
    expect(isOpen()).toBe(true);
    expect(panelEl.hasClass('claudian-hidden')).toBe(false);
    button.click();
    expect(isOpen()).toBe(false);

    button.click();
    doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(isOpen()).toBe(false);

    button.click();
    doc.dispatchEvent({ type: 'click', target: q('.claudian-model-panel-heading') });
    expect(isOpen()).toBe(true);
    doc.dispatchEvent({ type: 'click', target: createMockEl() });
    expect(isOpen()).toBe(false);
  });

  it('models column: heading, description, selection and group subheading', () => {
    const { q, rows, parentEl } = setup();
    expect(q('.claudian-model-panel-heading').textContent).toBe('Model');
    const values = rows().map((r: any) => r.getAttribute('data-value'));
    expect(values).toEqual(['haiku', 'opus', 'gpt']);
    const opus = rows()[1];
    expect(opus.hasClass('selected')).toBe(true);
    expect(opus.getAttribute('aria-pressed')).toBe('true');
    expect(opus.querySelector('.claudian-model-panel-desc').textContent).toBe('Most capable');
    expect(rows()[0].hasClass('selected')).toBe(false);
    expect(parentEl.querySelector('.claudian-model-group').textContent).toBe('Codex');
  });

  it('picking a model keeps the panel open and redraws the levels for the new model', async () => {
    const { button, rows, callbacks, isOpen, chipText, q, levels } = setup();
    button.click();
    expect(isOpen()).toBe(true);
    expect(q('.claudian-model-panel-levels').querySelector('.claudian-model-panel-heading').textContent).toBe('Wysiłek');

    rows()[0].click();
    await flush();

    expect(callbacks.onModelChange).toHaveBeenCalledWith('haiku');
    expect(isOpen()).toBe(true);
    expect(chipText()).toBe('Haiku · Low');
    expect(q('.claudian-model-panel-levels').querySelector('.claudian-model-panel-heading').textContent).toBe('Myślenie');
    expect(levels().map((l: any) => l.getAttribute('data-value'))).toEqual(['high', 'low', 'off']);
    expect(rows()[0].hasClass('selected')).toBe(true);
  });

  it('adaptive model lists effort levels deepest first with descriptions as titles', () => {
    const { levels } = setup();
    expect(levels().map((l: any) => l.querySelector('.claudian-model-panel-level-label').textContent))
      .toEqual(['High', 'Medium', 'Low']);
    // Kreski siły: najgłębszy ma wszystkie 4, najszybszy co najmniej jedną.
    const lit = (l: any) => l.querySelectorAll('.claudian-model-panel-bar').filter((b: any) => b.hasClass('is-on')).length;
    expect(levels().map(lit)).toEqual([4, 3, 1]);
    expect(levels()[1].hasClass('selected')).toBe(true);
    expect(levels()[2].getAttribute('title')).toBe('Fastest');
  });

  it('non-adaptive model lists the thinking budget', () => {
    const { levels, q, chipText } = setup({ adaptive: false });
    expect(q('.claudian-model-panel-levels').querySelector('.claudian-model-panel-heading').textContent).toBe('Myślenie');
    expect(levels().map((l: any) => l.getAttribute('data-value'))).toEqual(['high', 'low', 'off']);
    expect(chipText()).toBe('Opus · Low');
  });

  it('picking an effort level calls the callback, updates the chip and closes the panel', async () => {
    const { button, levels, callbacks, isOpen, chipText } = setup();
    button.click();
    levels()[0].click();
    await flush();
    expect(callbacks.onEffortLevelChange).toHaveBeenCalledWith('high');
    expect(callbacks.onThinkingBudgetChange).not.toHaveBeenCalled();
    expect(chipText()).toBe('Opus · High');
    expect(isOpen()).toBe(false);
  });

  it('picking a budget level calls onThinkingBudgetChange', async () => {
    const { button, levels, callbacks, isOpen } = setup({ adaptive: false });
    button.click();
    levels()[2].click();
    await flush();
    expect(callbacks.onThinkingBudgetChange).toHaveBeenCalledWith('off');
    expect(isOpen()).toBe(false);
  });

  it('closing removes the document listeners', () => {
    const { button, panel } = setup();
    button.click();
    expect(doc.getEventListenerCount('click')).toBe(1);
    expect(doc.getEventListenerCount('keydown')).toBe(1);
    panel.close();
    expect(doc.getEventListenerCount('click')).toBe(0);
    expect(doc.getEventListenerCount('keydown')).toBe(0);
    const closeSpy = jest.spyOn(panel, 'close');
    doc.dispatchEvent({ type: 'click', target: createMockEl() });
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
