import { registerPastedText, shouldCollapsePaste } from '../../../utils/pastedText';

/**
 * Wklejenie dlugiego tekstu w pole wpisywania wstawia znacznik zamiast sciany tekstu.
 * Obrazy obsluguje ImageContext — tu wychodzimy, gdy schowek niesie plik.
 * Zwraca funkcje odpinajaca nasluch.
 */
export function attachPasteCollapse(inputEl: HTMLTextAreaElement): () => void {
  const onPaste = (event: ClipboardEvent): void => {
    const data = event.clipboardData;
    if (!data) return;
    for (let i = 0; i < data.items.length; i++) {
      if (data.items[i].kind === 'file') return;
    }
    const text = data.getData('text/plain');
    if (!text || !shouldCollapsePaste(text)) return;

    event.preventDefault();
    const placeholder = registerPastedText(inputEl, text);
    const before = inputEl.value.slice(0, inputEl.selectionStart ?? inputEl.value.length);
    const after = inputEl.value.slice(inputEl.selectionEnd ?? inputEl.value.length);
    inputEl.value = `${before}${placeholder}${after}`;
    const caret = before.length + placeholder.length;
    inputEl.setSelectionRange(caret, caret);
    // Bez tego pole nie przeliczy wysokosci ani stanu przycisku wyslania.
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  };
  inputEl.addEventListener('paste', onPaste);
  return () => inputEl.removeEventListener('paste', onPaste);
}
