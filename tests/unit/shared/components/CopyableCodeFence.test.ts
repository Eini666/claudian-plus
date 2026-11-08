import { createMockEl } from '@test/helpers/MockElement';
import { setIcon } from 'obsidian';

import {
  enhanceRenderedCodeFence,
  renderCopyableCodeFence,
} from '@/shared/components/CopyableCodeFence';

describe('CopyableCodeFence', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(setIcon).mockClear();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: (tag: string) => createMockEl(tag),
      },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  it('renders a standard code fence and shows transient copy feedback', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      const container = createMockEl();
      const prompt = 'Line one\n1. Line two';

      const wrapper = renderCopyableCodeFence(container, prompt, {
        copyLabel: 'Copy prompt',
      });

      expect((wrapper as any).hasClass('claudian-code-wrapper')).toBe(true);
      expect((wrapper as any).children[0]?.children[0]?.textContent).toBe(prompt);
      const copyButton = (wrapper as any).querySelector('.copy-code-button');
      expect(copyButton.getAttribute('aria-label')).toBe('Copy prompt');

      copyButton.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(prompt);
      expect(copyButton.textContent).toBe('Copied!');
      expect(copyButton.hasClass('copied')).toBe(true);

      jest.advanceTimersByTime(1_500);
      expect(copyButton.textContent).toBe('');
      expect(copyButton.hasClass('copied')).toBe(false);
      expect(setIcon).toHaveBeenLastCalledWith(copyButton, 'copy');
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('copies through the clipboard of the window that owns the button (popout)', async () => {
    const globalWrite = jest.fn().mockResolvedValue(undefined);
    const popoutWrite = jest.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: globalWrite } });
    try {
      const wrapper = renderCopyableCodeFence(createMockEl(), 'popout text', { copyLabel: 'Copy' });
      const copyButton = (wrapper as any).querySelector('.copy-code-button');
      Object.defineProperty(copyButton, 'ownerDocument', {
        configurable: true,
        value: { defaultView: { navigator: { clipboard: { writeText: popoutWrite } } } },
      });

      copyButton.click();
      await Promise.resolve();

      expect(popoutWrite).toHaveBeenCalledWith('popout text');
      expect(globalWrite).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    }
  });

  it('keeps a hyphenated language label whole', () => {
    const container = createMockEl();
    const pre = container.createEl('pre');
    Object.defineProperty(pre, 'parentElement', { configurable: true, value: container });
    const code = pre.createEl('code', { text: 'x' });
    code.className = 'is-loaded language-objective-c';
    const querySelector = pre.querySelector.bind(pre);
    pre.querySelector = (selector: string) => (selector.startsWith('code[') ? code : querySelector(selector));

    const wrapper = enhanceRenderedCodeFence(pre);

    expect((wrapper as any).querySelector('.claudian-code-lang-label')
      ?.querySelector('.claudian-code-lang-text')?.textContent).toBe('objective-c');
  });

  it('adopts a Markdown-rendered fence without duplicating its wrapper', () => {
    const container = createMockEl();
    const pre = container.createEl('pre');
    Object.defineProperty(pre, 'parentElement', {
      configurable: true,
      value: container,
    });
    const code = pre.createEl('code', { text: 'const ready = true;' });
    code.className = 'language-typescript';
    const copyButton = pre.createEl('button', { cls: 'copy-code-button' });
    const querySelector = pre.querySelector.bind(pre);
    pre.querySelector = (selector: string) => (
      selector.startsWith('code[') ? code : querySelector(selector)
    );

    const wrapper = enhanceRenderedCodeFence(pre);
    Object.defineProperty(pre, 'parentElement', {
      configurable: true,
      value: wrapper,
    });
    const repeated = enhanceRenderedCodeFence(pre);

    expect(repeated).toBe(wrapper);
    expect((wrapper as any).hasClass('claudian-code-wrapper')).toBe(true);
    expect((wrapper as any).hasClass('has-language')).toBe(true);
    // Atrapa elementu nie obsluguje selektorow potomka — dwa kroki zamiast jednego.
    expect((wrapper as any).querySelector('.claudian-code-lang-label')
      ?.querySelector('.claudian-code-lang-text')?.textContent).toBe('typescript');
    expect((wrapper as any).children).toContain(copyButton);
    expect(container.querySelectorAll('.claudian-code-wrapper')).toHaveLength(1);
  });
  it('language label shows a copy icon and keeps it while confirming the copy', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const container = createMockEl();
      const pre = container.createEl('pre');
      Object.defineProperty(pre, 'parentElement', { configurable: true, value: container });
      const code = pre.createEl('code', { text: 'console.log(1)' });
      code.className = 'language-js';
      const querySelector = pre.querySelector.bind(pre);
      pre.querySelector = (selector: string) => (selector.startsWith('code[') ? code : querySelector(selector));

      const wrapper = enhanceRenderedCodeFence(pre);
      const label = (wrapper as any).querySelector('.claudian-code-lang-label');
      const icon = label.querySelector('.claudian-code-copy-icon');

      expect(icon).toBeTruthy();
      expect(setIcon).toHaveBeenCalledWith(icon, 'copy');
      expect(label.getAttribute('aria-label')).toBe('Kopiuj kod');

      label.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('console.log(1)');
      expect(label.querySelector('.claudian-code-lang-text').textContent).toBe('Copied!');
      expect(label.querySelector('.claudian-code-copy-icon')).toBe(icon);

      jest.advanceTimersByTime(1_500);
      expect(label.querySelector('.claudian-code-lang-text').textContent).toBe('js');
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    }
  });
  it('collapses a long rendered block and toggles it with the expand button', () => {
    const container = createMockEl();
    const pre = container.createEl('pre');
    Object.defineProperty(pre, 'parentElement', { configurable: true, value: container });
    const longCode = Array.from({ length: 30 }, (_, i) => `linia ${i}`).join('\n');
    const longCodeEl = pre.createEl('code', { text: longCode });
    // Atrapa szuka tylko po klasach — tag `code` trzeba podac recznie, jak w tescie wyzej.
    const queryLong = pre.querySelector.bind(pre);
    pre.querySelector = (selector: string) => (selector === 'code' ? longCodeEl : queryLong(selector));

    const wrapper = enhanceRenderedCodeFence(pre) as any;
    const toggle = wrapper.querySelector('.claudian-code-expand');

    expect(wrapper.hasClass('is-collapsed')).toBe(true);
    expect(toggle.textContent).toBe('Rozwiń (30 linii)');

    toggle.click();
    expect(wrapper.hasClass('is-collapsed')).toBe(false);
    expect(toggle.textContent).toBe('Zwiń');

    toggle.click();
    expect(wrapper.hasClass('is-collapsed')).toBe(true);
  });

  it('leaves a short rendered block expanded without a toggle', () => {
    const container = createMockEl();
    const pre = container.createEl('pre');
    Object.defineProperty(pre, 'parentElement', { configurable: true, value: container });
    const shortCodeEl = pre.createEl('code', { text: 'a\nb\nc' });
    const queryShort = pre.querySelector.bind(pre);
    pre.querySelector = (selector: string) => (selector === 'code' ? shortCodeEl : queryShort(selector));

    const wrapper = enhanceRenderedCodeFence(pre) as any;

    expect(wrapper.hasClass('is-collapsed')).toBe(false);
    expect(wrapper.querySelector('.claudian-code-expand')).toBeFalsy();
  });
});
