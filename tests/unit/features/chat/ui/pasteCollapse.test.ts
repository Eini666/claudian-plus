/**
 * @jest-environment jsdom
 */
import { attachPasteCollapse } from '@/features/chat/ui/pasteCollapse';
import { expandPastedText } from '@/utils/pastedText';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `linia ${i}`).join('\n');

function paste(el: HTMLElement, text: string, kinds: string[] = ['string']) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: kinds.map(kind => ({ kind })),
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  });
  el.dispatchEvent(event);
  return event;
}

describe('attachPasteCollapse', () => {
  let input: HTMLTextAreaElement;
  let detach: () => void;

  beforeEach(() => {
    input = document.createElement('textarea');
    document.body.appendChild(input);
    detach = attachPasteCollapse(input);
  });

  afterEach(() => {
    detach();
    input.remove();
  });

  it('długa wklejka staje się znacznikiem w miejscu kursora i rozwija się przy wysyłce', () => {
    input.value = 'przed  po';
    input.setSelectionRange(6, 6);
    const onInput = jest.fn();
    input.addEventListener('input', onInput);

    const event = paste(input, lines(120));

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('przed [Wklejony tekst #1 · 120 linii] po');
    expect(onInput).toHaveBeenCalled();
    expect(expandPastedText(input, input.value)).toBe(`przed ${lines(120)} po`);
  });

  it('krótka wklejka wchodzi normalnie', () => {
    expect(paste(input, lines(5)).defaultPrevented).toBe(false);
    expect(input.value).toBe('');
  });

  it('obraz w schowku zostaje dla obsługi obrazów', () => {
    expect(paste(input, lines(120), ['file']).defaultPrevented).toBe(false);
  });

  it('po odpięciu nasłuchu nic nie przechwytuje', () => {
    detach();
    expect(paste(input, lines(120)).defaultPrevented).toBe(false);
  });
});
