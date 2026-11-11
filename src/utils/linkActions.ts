/**
 * Linki w rozmowie poza wikilinkami: adresy i pelne sciezki wpisane w `kod`
 * oraz menu prawego kliku na kazdym linku (Electron nie ma natywnego, wiec bez
 * tego linku nie dalo sie skopiowac).
 */

import * as fs from 'fs';
import type { App, TFile } from 'obsidian';
import { Menu, Notice } from 'obsidian';
import * as path from 'path';

import { fileUrlToPath, localPageUrl } from './localPageServer';
import { getVaultFileByPath } from './obsidianCompat';
import { getVaultPath } from './path';

const URL_PATTERN = /^(?:https?:\/\/|mailto:|obsidian:\/\/|file:\/\/\/)\S+$/i;
// Windows (`C:\x`, `C:/x`) albo Git Bash (`/c/x`), na koncu opcjonalnie `:linia[:kolumna]`.
const ABS_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\/[a-zA-Z]\/)[^<>"|?*\r\n]*$/;
const LINE_SUFFIX = /:\d+(?::\d+)?$/;
// Rozszerzenia, ktore Obsidian otwiera sam; reszta idzie do Eksploratora.
const OBSIDIAN_EXTENSIONS = new Set(['md', 'canvas', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export type LinkInfo =
  | { kind: 'url'; url: string }
  | { kind: 'vault'; target: string; file: TFile | null; absPath: string | null }
  | { kind: 'path'; absPath: string };

/** `C:/x/y.php:120` i `/c/x/y.php` → `C:\x\y.php`. */
export function toWindowsPath(raw: string): string {
  let p = raw.trim().replace(LINE_SUFFIX, '');
  const bash = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (bash) p = `${bash[1].toUpperCase()}:/${bash[2]}`;
  return p.replace(/\//g, '\\');
}

export function isAbsolutePathText(text: string): boolean {
  return ABS_PATH_PATTERN.test(text.trim());
}

export function isUrlText(text: string): boolean {
  return URL_PATTERN.test(text.trim());
}

function electronShell(): { openExternal(url: string): Promise<void>; openPath(p: string): Promise<string>; showItemInFolder(p: string): void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell istnieje tylko w rendererze Obsidiana.
    return (require('electron') as { shell?: ReturnType<typeof electronShell> }).shell ?? null;
  } catch {
    return null;
  }
}

/**
 * Inline `kod` z samym adresem albo pelna sciezka staje sie linkiem.
 * Bloki ```kodu``` zostaja tekstem — tam adres bywa czescia komendy.
 */
export function processCodeLinks(container: HTMLElement): void {
  container.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.parentElement?.tagName === 'PRE' || codeEl.closest('a')) return;
    const text = (codeEl.textContent ?? '').trim();
    if (!text) return;

    const parent = codeEl.parentElement;
    if (!parent) return;

    let link: HTMLAnchorElement | null = null;
    if (isUrlText(text)) {
      link = parent.createEl('a', {
        cls: 'claudian-url-link external-link',
        attr: { href: text, title: text },
      });
    } else if (isAbsolutePathText(text)) {
      const absPath = toWindowsPath(text);
      link = parent.createEl('a', {
        cls: 'claudian-path-link',
        attr: { 'data-path': absPath, title: absPath },
      });
    }
    if (!link) return;
    // createEl dopina link na koncu rodzica; replaceWith przenosi go na miejsce kodu.
    codeEl.replaceWith(link);
    link.appendChild(codeEl);
  });
}

function vaultRelative(app: App, absPath: string): string | null {
  const root = getVaultPath(app);
  if (!root) return null;
  const rel = path.win32.relative(root, absPath);
  if (!rel || rel.startsWith('..') || path.win32.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

/**
 * Katalog nadrzedny z folderem konfiguracji — czyli inny vault, ktory Obsidian otworzy
 * przez `obsidian://`. Nazwe folderu bierzemy z biezacego vaulta (ten sam uzytkownik).
 */
function isInsideSomeVault(app: App, absPath: string): boolean {
  const configDir = app.vault.configDir;
  let dir = path.win32.dirname(absPath);
  for (;;) {
    if (fs.existsSync(path.win32.join(dir, configDir))) return true;
    const parent = path.win32.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function resolveVaultLink(app: App, target: string): TFile | null {
  const subpath = target.search(/[#^]/);
  const linkPath = subpath >= 0 ? target.slice(0, subpath) : target;
  if (!linkPath) return null;
  return app.metadataCache.getFirstLinkpathDest(linkPath, '')
    ?? getVaultFileByPath(app, linkPath)
    ?? (linkPath.endsWith('.md') ? null : getVaultFileByPath(app, `${linkPath}.md`));
}

export function describeLink(app: App, link: HTMLAnchorElement): LinkInfo | null {
  if (link.classList.contains('claudian-path-link') && link.dataset.path) {
    return { kind: 'path', absPath: link.dataset.path };
  }
  const href = link.getAttribute('href') ?? '';
  if (link.classList.contains('external-link') || URL_PATTERN.test(href)) {
    return href ? { kind: 'url', url: href } : null;
  }
  if (link.classList.contains('internal-link') || link.classList.contains('claudian-file-link')) {
    const target = link.dataset.href || href;
    if (!target) return null;
    const file = resolveVaultLink(app, target);
    const root = getVaultPath(app);
    return { kind: 'vault', target, file, absPath: file && root ? path.win32.join(root, file.path) : null };
  }
  return null;
}

/**
 * Pod linkiem do vaulta pokazuje, gdzie lezy plik, a nierozwiazany oznacza —
 * klik w niego zalozylby pusty plik-ducha (18.09: notatka z drugiego vaulta).
 */
export function annotateVaultLinks(app: App, container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>('a.internal-link, a.claudian-file-link').forEach((link) => {
    const target = link.dataset.href || link.getAttribute('href');
    if (!target) return;
    const file = resolveVaultLink(app, target);
    if (file) {
      link.title = file.path;
    } else {
      link.classList.add('is-unresolved');
      link.title = `Nie ma w tym vaulcie: ${target}`;
    }
  });
}

// openExternal oddaje adres handlerowi systemu: `file:` uruchomilby `.bat`, obcy schemat — dowolna aplikacje.
const SAFE_EXTERNAL_URL = /^(?:https?:\/\/|mailto:|obsidian:\/\/open\?)/i;

export function isSafeExternalUrl(url: string): boolean {
  return SAFE_EXTERNAL_URL.test(url.trim());
}

export function openUrl(url: string): void {
  if (!isSafeExternalUrl(url)) {
    new Notice(`Nie otwieram tego adresu z rozmowy: ${url}`);
    return;
  }
  const shell = electronShell();
  if (shell) void shell.openExternal(url);
  else window.open(url);
}

const WEB_PAGE_EXT = /\.html?$/i;

/** Plik, ktory ma sens jako strona we wbudowanej przegladarce (makieta, raport). */
export function isLocalWebPage(absPath: string): boolean {
  return WEB_PAGE_EXT.test(absPath);
}

/**
 * Strony (http/https, lokalne `.html` i `file:///`) we wbudowanej przegladarce Obsidiana w nowej
 * karcie (użytkownik, 01.11). Wylaczona „Przegladarka internetowa” → przegladarka systemowa.
 * mailto/obsidian i reszta schematow — jak dotad przez system.
 */
export async function openInBrowser(app: App, target: string): Promise<void> {
  const local = fileUrlToPath(target) ?? (isAbsolutePathText(target) ? toWindowsPath(target) : null);
  let url = target;
  if (local) {
    if (!fs.existsSync(local)) {
      new Notice(`Nie ma takiej ścieżki: ${local}`);
      return;
    }
    url = await localPageUrl(local, app.vault.configDir);
  }
  const webViewer = (app as unknown as { internalPlugins?: { getEnabledPluginById(id: string): unknown } })
    .internalPlugins?.getEnabledPluginById('webviewer');
  if (!/^https?:\/\//i.test(url) || !webViewer) {
    openUrl(url);
    return;
  }
  await app.workspace.getLeaf('tab').setViewState({ type: 'webviewer', active: true, state: { url, navigate: true } });
}

export function revealInExplorer(absPath: string): void {
  const shell = electronShell();
  if (!shell) return;
  if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) void shell.openPath(absPath);
  else shell.showItemInFolder(absPath);
}

/**
 * Pelna sciezka: plik z tego vaulta w Obsidianie, notatka z innego vaulta przez
 * `obsidian://open`, cala reszta w Eksploratorze. Nigdy nie uruchamia pliku —
 * `.bat` albo `.ps1` z odpowiedzi nie ma prawa wystartowac od klikniecia.
 */
export function openAbsolutePath(app: App, absPath: string): void {
  if (!fs.existsSync(absPath)) {
    new Notice(`Nie ma takiej ścieżki: ${absPath}`);
    return;
  }
  const ext = path.win32.extname(absPath).slice(1).toLowerCase();
  const isFile = fs.statSync(absPath).isFile();
  // Strona to tylko podglad w przegladarce Obsidiana — nadal nic nie uruchamiamy.
  if (isFile && isLocalWebPage(absPath)) {
    void openInBrowser(app, absPath);
    return;
  }
  const rel = vaultRelative(app, absPath);
  if (isFile && rel && OBSIDIAN_EXTENSIONS.has(ext) && getVaultFileByPath(app, rel)) {
    void app.workspace.openLinkText(rel, '', 'tab');
    return;
  }
  if (isFile && !rel && ext === 'md' && isInsideSomeVault(app, absPath)) {
    openUrl(`obsidian://open?path=${encodeURIComponent(absPath)}`);
    return;
  }
  revealInExplorer(absPath);
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).then(() => new Notice(`Skopiowane: ${text}`));
}

/** Menu prawego kliku na linku. Zwraca false, gdy element nie jest linkiem, ktory rozumiemy. */
export function showLinkMenu(app: App, link: HTMLAnchorElement, event: MouseEvent): boolean {
  const info = describeLink(app, link);
  if (!info) return false;
  const menu = new Menu();

  if (info.kind === 'url') {
    menu.addItem(item => item.setTitle('Otwórz we wbudowanej przeglądarce').setIcon('globe-2')
      .onClick(() => void openInBrowser(app, info.url)));
    menu.addItem(item => item.setTitle('Otwórz w przeglądarce systemowej').setIcon('external-link')
      .onClick(() => openUrl(info.url)));
    menu.addItem(item => item.setTitle('Kopiuj link').setIcon('copy')
      .onClick(() => copy(info.url)));
  } else if (info.kind === 'vault') {
    const { file, absPath } = info;
    if (file) {
      menu.addItem(item => item.setTitle('Otwórz w nowej karcie').setIcon('file-text')
        .onClick(() => void app.workspace.getLeaf('tab').openFile(file)));
      menu.addItem(item => item.setTitle('Kopiuj ścieżkę w vaulcie').setIcon('copy')
        .onClick(() => copy(file.path)));
    }
    if (absPath) {
      menu.addItem(item => item.setTitle('Kopiuj pełną ścieżkę').setIcon('copy')
        .onClick(() => copy(absPath)));
      menu.addItem(item => item.setTitle('Pokaż w folderze').setIcon('folder-open')
        .onClick(() => revealInExplorer(absPath)));
    }
    if (!file) {
      menu.addItem(item => item.setTitle('Kopiuj tekst linku').setIcon('copy')
        .onClick(() => copy(info.target)));
    }
  } else {
    const { absPath } = info;
    menu.addItem(item => item.setTitle('Otwórz').setIcon('file-text')
      .onClick(() => openAbsolutePath(app, absPath)));
    menu.addItem(item => item.setTitle('Kopiuj ścieżkę').setIcon('copy')
      .onClick(() => copy(absPath)));
    menu.addItem(item => item.setTitle('Pokaż w folderze').setIcon('folder-open')
      .onClick(() => revealInExplorer(absPath)));
  }

  event.preventDefault();
  menu.showAtMouseEvent(event);
  return true;
}
