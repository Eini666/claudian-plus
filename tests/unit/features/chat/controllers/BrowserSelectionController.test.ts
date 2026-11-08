/** @jest-environment jsdom */

import { BrowserSelectionController } from '@/features/chat/controllers/BrowserSelectionController';

function createMockContextTray() {
  return {
    setItems: jest.fn(),
    clearItems: jest.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BrowserSelectionController', () => {
  let controller: BrowserSelectionController;
  let app: any;
  let contextTray: ReturnType<typeof createMockContextTray>;
  let inputEl: HTMLTextAreaElement;
  let containerEl: HTMLElement;
  let selectionText = 'selected web snippet';
  let getSelectionSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    selectionText = 'selected web snippet';

    contextTray = createMockContextTray();
    inputEl = document.createElement('textarea');
    document.body.appendChild(inputEl);
    containerEl = document.createElement('div');
    const selectionAnchor = document.createElement('span');
    containerEl.appendChild(selectionAnchor);

    getSelectionSpy = jest.spyOn(document, 'getSelection').mockImplementation(() => ({
      toString: () => selectionText,
      anchorNode: selectionAnchor,
      focusNode: selectionAnchor,
    } as unknown as Selection));

    const view = {
      getViewType: () => 'surfing-view',
      getDisplayText: () => 'Surfing',
      containerEl,
      currentUrl: 'https://example.com',
    };

    app = {
      workspace: {
        activeLeaf: { view },
        getMostRecentLeaf: jest.fn(() => ({ view })),
      },
    };

    controller = new BrowserSelectionController(app, contextTray as any, inputEl);
  });

  afterEach(() => {
    controller.stop();
    inputEl.remove();
    getSelectionSpy.mockRestore();
    jest.useRealTimers();
  });

  it('captures browser selection and updates indicator', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.getContext()).toEqual({
      source: 'browser:https://example.com',
      selectedText: 'selected web snippet',
      title: 'Surfing',
      url: 'https://example.com',
    });
    expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
      expect.objectContaining({
        label: '1 line selected',
      }),
    ]);
    expect(contextTray.setItems.mock.calls[0][1][0]).not.toHaveProperty('title');
  });

  it('shows line-based indicator text for multi-line browser selection', async () => {
    selectionText = 'line 1\nline 2';
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(contextTray.setItems).toHaveBeenLastCalledWith('browser-selection', [
      expect.objectContaining({ label: '2 lines selected' }),
    ]);
  });

  it('clears selection when text is deselected and input is not focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('keeps selection while input is focused', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    selectionText = '';
    inputEl.focus();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(true);
  });

  it('clears selection when clear is called', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    controller.clear();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('clears selection from the tray remove action', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    const items = contextTray.setItems.mock.calls[0][1];
    items[0].onRemove();

    expect(controller.hasSelection()).toBe(false);
    expect(contextTray.clearItems).toHaveBeenCalledWith('browser-selection');
  });

  it('handles polling errors without unhandled rejection', async () => {
    const extractSpy = jest.spyOn(controller as any, 'extractSelectedText')
      .mockRejectedValueOnce(new Error('poll failed'));

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(extractSpy).toHaveBeenCalled();
    expect(controller.hasSelection()).toBe(false);
  });
  it('keeps the selection when another tab becomes active (11.09 regression)', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(true);

    // Przelaczenie na karte Claudiana: aktywna nie jest juz przegladarka, kursora jeszcze nie ma w polu.
    const chatView = { getViewType: () => 'claudian-view', containerEl: document.createElement('div') };
    app.workspace.getMostRecentLeaf.mockReturnValue({ view: chatView });
    selectionText = '';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.getContext()?.selectedText).toBe('selected web snippet');
  });

  it('reads a visible browser outside the most recent leaf, e.g. in a sidebar', async () => {
    getSelectionSpy.mockImplementation(() => ({ toString: () => '', anchorNode: null, focusNode: null } as unknown as Selection));
    const sidebarEl = document.createElement('div');
    const webview = document.createElement('webview') as HTMLElement & { executeJavaScript?: jest.Mock };
    webview.executeJavaScript = jest.fn().mockResolvedValue('tekst z panelu bocznego');
    sidebarEl.appendChild(webview);
    (sidebarEl as any).isShown = () => true;
    const sidebarView = { getViewType: () => 'webviewer', getDisplayText: () => 'GitHub', containerEl: sidebarEl, url: 'https://github.com' };
    const chatView = { getViewType: () => 'claudian-view', containerEl: document.createElement('div') };
    app.workspace.getMostRecentLeaf.mockReturnValue({ view: chatView });
    app.workspace.iterateAllLeaves = jest.fn((cb: (leaf: unknown) => void) => {
      cb({ view: chatView });
      cb({ view: sidebarView });
    });

    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(controller.getContext()).toEqual(expect.objectContaining({
      selectedText: 'tekst z panelu bocznego',
      url: 'https://github.com',
    }));
  });

  it('does not recapture a dismissed selection until it changes', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    controller.dismiss();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.hasSelection()).toBe(false);

    selectionText = 'inny fragment';
    jest.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(controller.getContext()?.selectedText).toBe('inny fragment');
  });

  it('tray remove action dismisses instead of letting the poll bring it back', async () => {
    controller.start();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    contextTray.setItems.mock.calls[0][1][0].onRemove();
    jest.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(controller.hasSelection()).toBe(false);
  });
});
