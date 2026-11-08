/**
 * @jest-environment jsdom
 */
import { Menu, TFile } from 'obsidian';

import { MessageSelectionMenu } from '@/features/chat/controllers/MessageSelectionMenu';

function setup(inputValue = '') {
  document.body.innerHTML = '';
  const messagesEl = document.createElement('div');
  messagesEl.innerHTML = '<p id="msg">Pierwsza linia odpowiedzi</p>';
  const outsideEl = document.createElement('p');
  outsideEl.textContent = 'poza rozmową';
  const inputEl = document.createElement('textarea');
  inputEl.value = inputValue;
  document.body.append(messagesEl, outsideEl, inputEl);

  const scratchpad = new (TFile as any)('Brudnopis.md');
  const vault = {
    getAbstractFileByPath: jest.fn((p: string) => (p === 'Brudnopis.md' ? scratchpad : null)),
    append: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(new (TFile as any)('x.md')),
    createFolder: jest.fn().mockResolvedValue(undefined),
  };
  const openFile = jest.fn().mockResolvedValue(undefined);
  const app = { vault, workspace: { getLeaf: jest.fn(() => ({ openFile })) } } as any;
  const menu = new MessageSelectionMenu(app, messagesEl, inputEl, () => 'Ari');
  return { messagesEl, outsideEl, inputEl, vault, openFile, menu };
}

function select(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function rightClick(el: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

const lastMenu = () => (Menu as any).instances[(Menu as any).instances.length - 1];
const item = (title: string) => lastMenu().items.find((i: any) => i.title === title);

describe('MessageSelectionMenu', () => {
  beforeEach(() => {
    (Menu as any).instances.length = 0;
  });

  it('bez zaznaczenia zostawia natywne menu w spokoju', () => {
    const { messagesEl } = setup();
    document.getSelection()!.removeAllRanges();

    const event = rightClick(messagesEl);

    expect(event.defaultPrevented).toBe(false);
    expect((Menu as any).instances).toHaveLength(0);
  });

  it('ignoruje zaznaczenie spoza rozmowy', () => {
    const { messagesEl, outsideEl } = setup();
    select(outsideEl);

    expect(rightClick(messagesEl).defaultPrevented).toBe(false);
  });

  it('pokazuje menu z kopiowaniem, cytatem i trzema celami', () => {
    const { messagesEl } = setup();
    select(messagesEl.querySelector('#msg')!);

    expect(rightClick(messagesEl).defaultPrevented).toBe(true);
    expect(lastMenu().items.map((i: any) => i.title)).toEqual([
      'Kopiuj', 'Cytuj', 'Dopisz do brudnopisu', 'Nowa notatka w zasobach', 'Utwórz zadanie',
    ]);
  });

  it('Cytuj wstawia cytat od nowej linii i powiadamia pole', () => {
    const { messagesEl, inputEl } = setup('mój komentarz');
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    const onInput = jest.fn();
    inputEl.addEventListener('input', onInput);
    select(messagesEl.querySelector('#msg')!);
    rightClick(messagesEl);

    item('Cytuj').clickHandler();

    expect(inputEl.value).toBe('mój komentarz\n\n> Pierwsza linia odpowiedzi\n\n');
    expect(inputEl.selectionStart).toBe(inputEl.value.length);
    expect(onInput).toHaveBeenCalled();
  });

  it('Do Brudnopisu dokleja datowany wpis do istniejacego pliku', async () => {
    const { messagesEl, vault } = setup();
    select(messagesEl.querySelector('#msg')!);
    rightClick(messagesEl);

    item('Dopisz do brudnopisu').clickHandler();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.append).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Brudnopis.md' }),
      expect.stringMatching(/^\n\n---\n\*Z rozmowy · .+\*\n\nPierwsza linia odpowiedzi\n$/),
    );
  });

  it('Nowa notatka zaklada folder, nie nadpisuje istniejacej i otwiera plik', async () => {
    const { messagesEl, vault, openFile } = setup();
    vault.getAbstractFileByPath.mockImplementation((p: string) => (
      p === 'Zasoby/Z rozmowy/Pierwsza linia odpowiedzi.md' ? new (TFile as any)(p) : null
    ));
    select(messagesEl.querySelector('#msg')!);
    rightClick(messagesEl);

    item('Nowa notatka w zasobach').clickHandler();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(vault.createFolder).toHaveBeenCalledWith('Zasoby/Z rozmowy');
    expect(vault.create).toHaveBeenCalledWith(
      'Zasoby/Z rozmowy/Pierwsza linia odpowiedzi (2).md',
      expect.stringContaining('# Pierwsza linia odpowiedzi'),
    );
    expect(openFile).toHaveBeenCalled();
  });

  it('destroy odpina nasluch', () => {
    const { messagesEl, menu } = setup();
    menu.destroy();
    select(messagesEl.querySelector('#msg')!);

    expect(rightClick(messagesEl).defaultPrevented).toBe(false);
  });
});
describe('cytat niesie zrodlo', () => {
  beforeEach(() => {
    (Menu as any).instances.length = 0;
  });

  /** Otacza akapit elementem wiadomosci, tak jak robi to MessageRenderer. */
  function wWiadomosci(messagesEl: HTMLElement, id: string, role: string): HTMLElement {
    const msg = document.createElement('div');
    msg.className = 'claudian-message';
    msg.dataset.messageId = id;
    msg.dataset.role = role;
    const tresc = document.createElement('p');
    tresc.textContent = 'Pierwsza linia odpowiedzi';
    msg.append(tresc);
    messagesEl.innerHTML = '';
    messagesEl.append(msg);
    return tresc;
  }

  it('dokleja autora i kotwice odczytane z elementu wiadomosci', () => {
    const { messagesEl, inputEl } = setup();
    const tresc = wWiadomosci(messagesEl, 'a1b2c3d4e5f6', 'assistant');
    select(tresc);
    rightClick(messagesEl);

    item('Cytuj').clickHandler();

    expect(inputEl.value).toContain('> [Ari · msg a1b2c3d4]');
    expect(inputEl.value).toContain('> Pierwsza linia odpowiedzi');
  });

  it('rozroznia wiadomosc uzytkownika', () => {
    const { messagesEl, inputEl } = setup();
    const tresc = wWiadomosci(messagesEl, 'ffffffff1111', 'user');
    select(tresc);
    rightClick(messagesEl);

    item('Cytuj').clickHandler();

    expect(inputEl.value).toContain('> [Ty · msg ffffffff]');
  });

  it('bez elementu wiadomosci zostaje goly cytat', () => {
    const { messagesEl, inputEl } = setup();
    select(messagesEl.querySelector('#msg')!);
    rightClick(messagesEl);

    item('Cytuj').clickHandler();

    expect(inputEl.value.startsWith('> Pierwsza linia')).toBe(true);
    expect(inputEl.value).not.toContain('[');
  });
});
