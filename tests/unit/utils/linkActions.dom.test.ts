/**
 * @jest-environment jsdom
 */
import { processFileLinks } from '@/utils/fileLink';
import { isAbsolutePathText, processCodeLinks, toWindowsPath } from '@/utils/linkActions';

describe('toWindowsPath', () => {
  it.each([
    ['C:\\xampp\\htdocs\\a.php', 'C:\\xampp\\htdocs\\a.php'],
    ['C:/xampp/htdocs/a.php:120', 'C:\\xampp\\htdocs\\a.php'],
    ['C:\\a\\b.ts:12:5', 'C:\\a\\b.ts'],
    ['/c/Users/Jan/x.md', 'C:\\Users\\Jan\\x.md'],
    ['C:\\Users\\Jan\\Documents\\Obsidian Vault\\Projects\\x.md', 'C:\\Users\\Jan\\Documents\\Obsidian Vault\\Projects\\x.md'],
  ])('%s → %s', (raw, expected) => {
    expect(toWindowsPath(raw)).toBe(expected);
  });

  it('nie bierze sciezek wzglednych ani komend', () => {
    expect(isAbsolutePathText('src/app.ts:12')).toBe(false);
    expect(isAbsolutePathText('cd C:\\x && ls')).toBe(false);
    expect(isAbsolutePathText('C:')).toBe(false);
  });
});

describe('processCodeLinks', () => {
  function render(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    processCodeLinks(el);
    return el;
  }

  it('adres w kodzie staje sie linkiem zewnetrznym', () => {
    const el = render('<p>Otworz <code>http://localhost/progallery-stripe/reset.php?key=1</code></p>');
    const a = el.querySelector('a.claudian-url-link')!;
    expect(a.getAttribute('href')).toBe('http://localhost/progallery-stripe/reset.php?key=1');
    expect(a.querySelector('code')).not.toBeNull();
  });

  it('pelna sciezka w kodzie staje sie linkiem do pliku', () => {
    const el = render('<p><code>C:/xampp/htdocs/app/index.php:42</code></p>');
    const a = el.querySelector<HTMLAnchorElement>('a.claudian-path-link')!;
    expect(a.dataset.path).toBe('C:\\xampp\\htdocs\\app\\index.php');
  });

  it('zostawia bloki kodu, komendy i sciezki wzgledne', () => {
    const el = render(
      '<pre><code>http://localhost/x</code></pre>'
      + '<p><code>B=http://localhost/x;</code> <code>src/a.ts</code></p>'
    );
    expect(el.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('annotateVaultLinks przez processFileLinks', () => {
  const app = {
    metadataCache: {
      getFirstLinkpathDest: jest.fn((p: string) => (p === 'note' ? { path: 'Zadania/note.md' } : null)),
    },
    vault: { getAbstractFileByPath: jest.fn(() => null) },
  } as any;

  it('rozwiazany link dostaje sciezke w dymku, nierozwiazany klase is-unresolved', () => {
    const el = document.createElement('div');
    el.innerHTML = '<a class="internal-link" data-href="note">note</a>'
      + '<a class="internal-link" data-href="26-09-2026">26-09-2026</a>';
    processFileLinks(app, el);
    const [ok, ghost] = Array.from(el.querySelectorAll('a'));
    expect(ok.title).toBe('Zadania/note.md');
    expect(ghost.classList.contains('is-unresolved')).toBe(true);
  });
});
