/**
 * @jest-environment jsdom
 */
import { isLocalUrl, isWebAssetEdit, reloadLocalBrowsers, scheduleLocalBrowserReload } from '@/features/chat/services/localBrowserReload';

function leafWithUrl(url: string | null) {
  const containerEl = document.createElement('div');
  const webview = document.createElement('webview') as HTMLElement & { reload?: jest.Mock; getURL?: () => string };
  webview.reload = jest.fn();
  if (url !== null) webview.setAttribute('src', url);
  containerEl.appendChild(webview);
  return { leaf: { view: { containerEl } }, reload: webview.reload };
}

function appWith(...leaves: { view: { containerEl: HTMLElement } }[]) {
  return { workspace: { getLeavesOfType: jest.fn(() => leaves) } } as any;
}

describe('localBrowserReload', () => {
  describe('isWebAssetEdit', () => {
    it('łapie zapis i edycję plików strony', () => {
      expect(isWebAssetEdit('Write', { file_path: 'C:/xampp/htdocs/mockup.html' })).toBe(true);
      expect(isWebAssetEdit('Edit', { file_path: '/srv/style.css' })).toBe(true);
      expect(isWebAssetEdit('Edit', { file_path: 'index.php' })).toBe(true);
    });

    it('pomija inne narzędzia i inne pliki', () => {
      expect(isWebAssetEdit('Bash', { file_path: 'x.html' })).toBe(false);
      expect(isWebAssetEdit('Write', { file_path: 'notatka.md' })).toBe(false);
      expect(isWebAssetEdit('Write', {})).toBe(false);
      expect(isWebAssetEdit('Write', undefined)).toBe(false);
    });
  });

  describe('isLocalUrl', () => {
    it('przyjmuje localhost, pętlę zwrotną i pliki z dysku', () => {
      expect(isLocalUrl('http://localhost/mockup.html')).toBe(true);
      expect(isLocalUrl('http://127.0.0.1:5173/')).toBe(true);
      expect(isLocalUrl('file:///C:/mockup.html')).toBe(true);
    });

    it('odrzuca strony obce i puste', () => {
      expect(isLocalUrl('https://github.com/YishenTu/claudian')).toBe(false);
      expect(isLocalUrl('https://localhost.evil.com/')).toBe(false);
      expect(isLocalUrl(null)).toBe(false);
    });
  });

  it('przeładowuje tylko karty z adresem lokalnym', () => {
    const local = leafWithUrl('http://localhost/mockup.html');
    const remote = leafWithUrl('https://example.com');
    const blank = leafWithUrl(null);

    expect(reloadLocalBrowsers(appWith(local.leaf, remote.leaf, blank.leaf))).toBe(1);
    expect(local.reload).toHaveBeenCalledTimes(1);
    expect(remote.reload).not.toHaveBeenCalled();
    expect(blank.reload).not.toHaveBeenCalled();
  });

  it('seria zapisów przeładowuje kartę raz, po ostatnim', () => {
    jest.useFakeTimers();
    try {
      const local = leafWithUrl('http://localhost/mockup.html');
      const app = appWith(local.leaf);

      scheduleLocalBrowserReload(app);
      jest.advanceTimersByTime(200);
      scheduleLocalBrowserReload(app);
      jest.advanceTimersByTime(200);
      expect(local.reload).not.toHaveBeenCalled();

      jest.advanceTimersByTime(400);
      expect(local.reload).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('nie wywraca się, gdy element karty nie umie się przeładować', () => {
    const containerEl = document.createElement('div');
    containerEl.appendChild(document.createElement('webview'));
    expect(reloadLocalBrowsers(appWith({ view: { containerEl } }))).toBe(0);
  });
});
