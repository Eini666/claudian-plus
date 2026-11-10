/** Drag payload type; foreign drags (files, text) are ignored by every drop target. */
export const CONVERSATION_DRAG_MIME = 'application/x-claudian-conversation';
export const DROP_TARGET_CLASS = 'is-drop-target';

function carriesConversation(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(CONVERSATION_DRAG_MIME);
}

function clearDropTargets(doc: Document): void {
  doc.querySelectorAll(`.${DROP_TARGET_CLASS}`).forEach(el => el.classList.remove(DROP_TARGET_CLASS));
}

export function makeConversationDraggable(rowEl: HTMLElement, conversationId: string): void {
  rowEl.draggable = true;
  rowEl.addEventListener('dragstart', (event) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(CONVERSATION_DRAG_MIME, conversationId);
    event.dataTransfer.effectAllowed = 'move';
  });
  // Cancelled drags (Escape, drop outside) leave no highlighted target behind.
  rowEl.addEventListener('dragend', () => clearDropTargets(rowEl.ownerDocument));
}

export function makeDropTarget(
  el: HTMLElement,
  onDrop: (conversationId: string) => void,
  isNoop?: (conversationId: string) => boolean,
): void {
  const highlight = (event: DragEvent): void => {
    if (!carriesConversation(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    el.classList.add(DROP_TARGET_CLASS);
  };
  el.addEventListener('dragenter', highlight);
  el.addEventListener('dragover', highlight);
  el.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && el.contains(event.relatedTarget as Node)) return;
    el.classList.remove(DROP_TARGET_CLASS);
  });
  el.addEventListener('drop', (event) => {
    el.classList.remove(DROP_TARGET_CLASS);
    if (!carriesConversation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const conversationId = event.dataTransfer?.getData(CONVERSATION_DRAG_MIME) ?? '';
    if (!conversationId || isNoop?.(conversationId)) return;
    onDrop(conversationId);
  });
}
