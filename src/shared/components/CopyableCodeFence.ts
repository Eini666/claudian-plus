import { setIcon } from 'obsidian';

import { linesLabel } from '../../utils/polishPlural';

export interface CopyableCodeFenceOptions {
  readonly copiedLabel?: string;
  readonly copyLabel: string;
}

const COPY_FEEDBACK_DURATION_MS = 1_500;
/** Dluzszy blok zwija sie do poczatku z przyciskiem „Rozwin” — kopiowanie bierze calosc. */
export const CODE_COLLAPSE_MIN_LINES = 25;

function bindCopyFeedback(
  target: HTMLElement,
  text: () => string,
  renderCopied: () => void,
  renderIdle: () => void,
): void {
  let feedbackTimeout: number | null = null;
  target.addEventListener('click', () => {
    // Wyskakujace okno Obsidiana ma wlasny schowek; globalny pisal do glownego okna (upstream 7a265b45).
    const clipboard = target.ownerDocument?.defaultView?.navigator?.clipboard
      ?? navigator.clipboard;
    if (!clipboard?.writeText) return;
    void clipboard.writeText(text()).then(() => {
      if (feedbackTimeout !== null) {
        window.clearTimeout(feedbackTimeout);
      }
      renderCopied();
      feedbackTimeout = window.setTimeout(() => {
        renderIdle();
        feedbackTimeout = null;
      }, COPY_FEEDBACK_DURATION_MS);
    }).catch(() => undefined);
  });
}

/** Builds the same plain code-fence surface used by rendered chat messages. */
export function renderCopyableCodeFence(
  container: HTMLElement,
  text: string,
  options: CopyableCodeFenceOptions,
): HTMLElement {
  const wrapper = container.createDiv({ cls: 'claudian-code-wrapper' });
  const pre = wrapper.createEl('pre');
  pre.createEl('code', { text });

  const copyButton = wrapper.createEl('button', {
    attr: { type: 'button' },
    cls: 'copy-code-button',
  });
  copyButton.setAttribute('aria-label', options.copyLabel);
  copyButton.title = options.copyLabel;

  const renderIdle = (): void => {
    copyButton.empty();
    setIcon(copyButton, 'copy');
    copyButton.classList.remove('copied');
  };
  renderIdle();
  bindCopyFeedback(
    copyButton,
    () => text,
    () => {
      copyButton.empty();
      copyButton.setText(options.copiedLabel ?? 'Copied!');
      copyButton.classList.add('copied');
    },
    renderIdle,
  );
  return wrapper;
}

/** Adopts an Obsidian-rendered `pre` and preserves its native copy button. */
export function enhanceRenderedCodeFence(pre: HTMLPreElement): HTMLElement {
  if (pre.parentElement?.classList.contains('claudian-code-wrapper')) {
    return pre.parentElement;
  }

  const wrapper = createDiv({ cls: 'claudian-code-wrapper' });
  pre.parentElement?.insertBefore(wrapper, pre);
  wrapper.appendChild(pre);

  const code = pre.querySelector<HTMLElement>('code[class*="language-"]');
  // Cala klasa `language-*` (np. `objective-c`, `c++`), nie tylko poczatek do myslnika (upstream 68c7fcc8).
  const language = (code?.className ?? '').split(/\s+/)
    .find(token => token.startsWith('language-') && token.length > 'language-'.length)
    ?.slice('language-'.length);
  if (code && language) {
    wrapper.classList.add('has-language');
    // Napis jezyka JEST przyciskiem kopiowania (zwykly przycisk jest wtedy ukryty
    // w CSS). Bez ikony nic tego nie zdradzalo — użytkownik kopiowal bloki recznie (11.09).
    const label = createSpan({ cls: 'claudian-code-lang-label' });
    label.setAttribute('aria-label', 'Kopiuj kod');
    label.title = 'Kopiuj kod';
    setIcon(label.createSpan({ cls: 'claudian-code-copy-icon' }), 'copy');
    const labelText = label.createSpan({ cls: 'claudian-code-lang-text', text: language });
    wrapper.appendChild(label);
    bindCopyFeedback(
      label,
      () => code.textContent ?? '',
      () => labelText.setText('Copied!'),
      () => labelText.setText(language),
    );
  }

  const copyButton = pre.querySelector<HTMLElement>('.copy-code-button');
  if (copyButton) wrapper.appendChild(copyButton);
  addCollapseToggle(wrapper, (pre.querySelector('code') ?? pre).textContent ?? '');
  return wrapper;
}

function addCollapseToggle(wrapper: HTMLElement, text: string): void {
  const lineCount = text.replace(/\n$/, '').split('\n').length;
  if (lineCount <= CODE_COLLAPSE_MIN_LINES) return;

  wrapper.classList.add('is-collapsed');
  const expandLabel = `Rozwiń (${linesLabel(lineCount)})`;
  const toggle = wrapper.createEl('button', {
    attr: { type: 'button' },
    cls: 'claudian-code-expand',
    text: expandLabel,
  });
  toggle.addEventListener('click', () => {
    const collapsed = wrapper.classList.toggle('is-collapsed');
    toggle.setText(collapsed ? expandLabel : 'Zwiń');
  });
}
