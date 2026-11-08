import { execFile } from 'child_process';
import * as fs from 'fs';
import type { App } from 'obsidian';
import { Menu, Notice, TFile } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { findNodeExecutable } from '../../../utils/env';
import { showLinkMenu } from '../../../utils/linkActions';
import { getVaultPath } from '../../../utils/path';
import {
  formatQuote,
  type QuoteSource,
  resourceNote,
  safeNoteName,
  scratchpadEntry,
  slugify,
  titleFromSelection,
} from '../../../utils/selectionActions';

// ponytail: sciezki z konwencji skarbca użytkownika (CLAUDE.md) — ustawienia, gdy fork trafi do kogos innego
const SCRATCHPAD = 'Brudnopis.md';
const RESOURCES_DIR = 'Zasoby/Z rozmowy';
const CREATE_TASK_SCRIPT = '.claude/tools/tasks/create-task.mjs';

/**
 * Prawy klik na ZAZNACZONYM tekscie w rozmowie: cytat do pola, dopisek do Brudnopisu,
 * osobna notatka albo zadanie. Bez zaznaczenia zostaje zwykle menu przegladarki.
 * Bierze fragment, nie cala wiadomosc — z odpowiedzi zwykle potrzebny jest jeden akapit.
 */
export class MessageSelectionMenu {
  private readonly onContextMenu = (event: MouseEvent): void => this.handle(event);

  constructor(
    private readonly app: App,
    private readonly messagesEl: HTMLElement,
    private readonly inputEl: HTMLTextAreaElement,
    private readonly getAssistantName: () => string | undefined = () => undefined,
  ) {
    messagesEl.addEventListener('contextmenu', this.onContextMenu);
  }

  private selectedText(): string {
    const selection = this.messagesEl.ownerDocument.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!text || !selection?.anchorNode || !this.messagesEl.contains(selection.anchorNode)) return '';
    return text;
  }

  /**
   * Wiadomosc, z ktorej pochodzi zaznaczenie. Zaznaczenie przez dwie wiadomosci
   * przypisujemy tej, w ktorej sie zaczelo — inaczej trzeba by zgadywac.
   */
  private quoteSource(): QuoteSource | undefined {
    const node = this.messagesEl.ownerDocument.getSelection()?.anchorNode;
    if (!node) return undefined;
    // nodeType 1 zamiast `Node.ELEMENT_NODE`: atrapy DOM w testach nie maja globalu `Node`.
    const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    const msg = el?.closest?.<HTMLElement>('.claudian-message');
    if (!msg) return undefined;
    return { id: msg.dataset?.messageId, role: msg.dataset?.role };
  }

  private handle(event: MouseEvent): void {
    // Prawy klik na linku: jego menu, nawet przy zaznaczeniu obok.
    const link = (event.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a');
    if (link && this.messagesEl.contains(link) && showLinkMenu(this.app, link, event)) return;

    const text = this.selectedText();
    if (!text) return;
    // Zrodlo czytamy TERAZ — po otwarciu menu zaznaczenie potrafi zniknac.
    const source = this.quoteSource();
    event.preventDefault();

    const menu = new Menu();
    // Wlasne menu zastepuje natywne, wiec kopiowanie musi zostac.
    menu.addItem(item => item.setTitle('Kopiuj').setIcon('copy')
      .onClick(() => void navigator.clipboard.writeText(text)));
    menu.addItem(item => item.setTitle('Cytuj').setIcon('quote-glyph')
      .onClick(() => this.quote(text, source)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Dopisz do brudnopisu').setIcon('file-plus')
      .onClick(() => void this.run(() => this.appendToScratchpad(text))));
    menu.addItem(item => item.setTitle('Nowa notatka w zasobach').setIcon('file-text')
      .onClick(() => void this.run(() => this.saveAsNote(text))));
    menu.addItem(item => item.setTitle('Utwórz zadanie').setIcon('check-square')
      .onClick(() => void this.run(() => this.createTask(text))));
    menu.showAtMouseEvent(event);
  }

  private async run(action: () => Promise<string>): Promise<void> {
    try {
      new Notice(await action());
    } catch (error) {
      new Notice(`Nie wyszło: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private quote(text: string, source?: QuoteSource): void {
    const input = this.inputEl;
    const quote = formatQuote(text, source, this.getAssistantName());
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const after = input.value.slice(input.selectionEnd ?? input.value.length);
    // Cytat zawsze od nowej linii, inaczej `>` przestaje byc cytatem.
    const lead = before && !before.endsWith('\n') ? '\n\n' : '';
    input.value = `${before}${lead}${quote}${after}`;
    const caret = before.length + lead.length + quote.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    // Bez tego pole nie przeliczy wysokosci ani stanu przycisku wyslania.
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private async appendToScratchpad(text: string): Promise<string> {
    const entry = scratchpadEntry(text, new Date());
    const file = this.app.vault.getAbstractFileByPath(SCRATCHPAD);
    if (file instanceof TFile) {
      await this.app.vault.append(file, entry);
    } else {
      await this.app.vault.create(SCRATCHPAD, entry.trimStart());
    }
    return 'Dopisane na koniec Brudnopisu';
  }

  private async saveAsNote(text: string): Promise<string> {
    const title = titleFromSelection(text);
    if (!this.app.vault.getAbstractFileByPath(RESOURCES_DIR)) {
      await this.app.vault.createFolder(RESOURCES_DIR);
    }
    const base = safeNoteName(title);
    let notePath = `${RESOURCES_DIR}/${base}.md`;
    for (let n = 2; this.app.vault.getAbstractFileByPath(notePath); n++) {
      notePath = `${RESOURCES_DIR}/${base} (${n}).md`;
    }
    const file = await this.app.vault.create(notePath, resourceNote(text, title, new Date()));
    // Otwarta w nowej karcie — tytul z pierwszej linii czesto wymaga poprawki.
    await this.app.workspace.getLeaf('tab').openFile(file);
    return `Notatka: ${notePath}`;
  }

  private async createTask(text: string): Promise<string> {
    const vaultPath = getVaultPath(this.app);
    const script = vaultPath ? path.join(vaultPath, CREATE_TASK_SCRIPT) : '';
    if (!script || !fs.existsSync(script)) throw new Error(`brak ${CREATE_TASK_SCRIPT} w skarbcu`);
    const node = findNodeExecutable();
    if (!node) throw new Error('nie znalazłam node.exe');

    // Tytul od `--` parser skryptu wzialby za kolejna flage.
    const title = titleFromSelection(text).replace(/^-+\s*/, '') || 'Fragment rozmowy';
    // Notatki przez plik: dluzszy fragment w argumencie Windows utnie na 32 tys. znakow.
    const notesFile = path.join(os.tmpdir(), `claudian-zadanie-${Date.now()}.md`);
    fs.writeFileSync(notesFile, text, 'utf8');
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(node, [
          script,
          '--slug', `${slugify(title)}-${Date.now().toString(36).slice(-4)}`,
          '--title', title,
          '--cel', 'Wrócić do fragmentu z rozmowy w Claudianie.',
          '--notatki-plik', notesFile,
          '--sekcja', 'BEZ TERMINU',
          '--termin',
        ], { cwd: vaultPath ?? undefined, timeout: 15_000, windowsHide: true }, (error, out, err) => {
          if (error) reject(new Error(err.trim() || error.message));
          else resolve(out.trim());
        });
      });
      return stdout || `Zadanie: ${title}`;
    } finally {
      fs.rmSync(notesFile, { force: true });
    }
  }

  destroy(): void {
    this.messagesEl.removeEventListener('contextmenu', this.onContextMenu);
  }
}
