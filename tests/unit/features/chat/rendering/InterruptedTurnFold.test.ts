import { createMockEl } from '@test/helpers/MockElement';

import {
  appendInterruptIndicator,
  foldInterruptedTurn,
} from '@/features/chat/rendering/InterruptedTurnFold';

describe('InterruptedTurnFold', () => {
  it('moves turn content into a collapsed body under the indicator header', () => {
    const contentEl = createMockEl();
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    const toolEl = contentEl.createDiv({ cls: 'claudian-tool-call' });

    foldInterruptedTurn(contentEl);

    expect(contentEl.children).toHaveLength(1);
    const wrapperEl = contentEl.children[0];
    expect(wrapperEl.hasClass('claudian-interrupted-turn')).toBe(true);
    const [headerEl, bodyEl] = wrapperEl.children;
    expect(headerEl.getAttribute('role')).toBe('button');
    expect(headerEl.getAttribute('tabindex')).toBe('0');
    expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    expect(headerEl.getAttribute('aria-label')).toBe('Interrupted turn - click to expand');
    expect(headerEl.querySelector('.claudian-interrupted')?.textContent).toBe('Interrupted');
    expect(headerEl.querySelector('.claudian-interrupted-hint')?.textContent)
      .toBe('· What should Claudian do instead?');
    expect(bodyEl.hasClass('claudian-hidden')).toBe(true);
    expect(bodyEl.children).toEqual([textEl, toolEl]);
  });

  it('toggles with keyboard and keeps the indicator out of the body', () => {
    const contentEl = createMockEl();
    contentEl.createDiv({ cls: 'claudian-text-block' });

    foldInterruptedTurn(contentEl);

    const [headerEl, bodyEl] = contentEl.children[0].children;
    headerEl.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: jest.fn() });
    expect(bodyEl.hasClass('claudian-hidden')).toBe(false);
    expect(headerEl.getAttribute('aria-expanded')).toBe('true');
    expect(contentEl.children[0].hasClass('expanded')).toBe(true);
    expect(bodyEl.querySelector('.claudian-interrupted')).toBeNull();
  });

  it('falls back to the plain indicator line when the turn has no content', () => {
    const contentEl = createMockEl();

    foldInterruptedTurn(contentEl);

    expect(contentEl.children).toHaveLength(1);
    expect(contentEl.querySelector('.claudian-interrupted-turn')).toBeNull();
    expect(contentEl.children[0].hasClass('claudian-text-block')).toBe(true);
    expect(contentEl.children[0].children[0].textContent).toBe('Interrupted');
  });

  it('appendInterruptIndicator keeps the existing markup', () => {
    const contentEl = createMockEl();

    appendInterruptIndicator(contentEl);

    const textEl = contentEl.children[0];
    expect(textEl.hasClass('claudian-text-block')).toBe(true);
    expect(textEl.children[0].hasClass('claudian-interrupted')).toBe(true);
    expect(textEl.children[1].hasClass('claudian-interrupted-hint')).toBe(true);
  });
});
