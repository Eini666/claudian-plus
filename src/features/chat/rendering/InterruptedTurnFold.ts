import { setupCollapsible } from './collapsible';

function appendIndicatorSpans(el: HTMLElement): void {
  el.createSpan({ cls: 'claudian-interrupted', text: 'Interrupted' });
  el.appendText(' ');
  el.createSpan({
    cls: 'claudian-interrupted-hint',
    text: '· What should Claudian do instead?',
  });
}

export function appendInterruptIndicator(contentEl: HTMLElement): void {
  appendIndicatorSpans(contentEl.createDiv({ cls: 'claudian-text-block' }));
}

/**
 * Moves the rendered turn into a collapsed body under the interrupt indicator.
 * A turn interrupted before any output keeps the plain indicator line.
 */
export function foldInterruptedTurn(contentEl: HTMLElement): void {
  const turnEls = Array.from(contentEl.children) as HTMLElement[];
  if (turnEls.length === 0) {
    appendInterruptIndicator(contentEl);
    return;
  }

  const wrapperEl = contentEl.createDiv({ cls: 'claudian-interrupted-turn' });
  const headerEl = wrapperEl.createDiv({ cls: 'claudian-interrupted-turn-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  const chevronEl = headerEl.createSpan({ cls: 'claudian-interrupted-turn-chevron', text: '›' });
  chevronEl.setAttribute('aria-hidden', 'true');
  const labelEl = headerEl.createSpan({ cls: 'claudian-interrupted-turn-label' });
  appendIndicatorSpans(labelEl);

  const bodyEl = wrapperEl.createDiv({ cls: 'claudian-interrupted-turn-content' });
  for (const el of turnEls) bodyEl.appendChild(el);
  contentEl.replaceChildren(wrapperEl);

  setupCollapsible(wrapperEl, headerEl, bodyEl, { isExpanded: false }, {
    baseAriaLabel: 'Interrupted turn',
  });
}
