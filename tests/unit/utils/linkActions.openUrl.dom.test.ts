/**
 * @jest-environment jsdom
 */
import { isSafeExternalUrl, openUrl } from '@/utils/linkActions';

describe('isSafeExternalUrl', () => {
  it.each([
    'https://example.com/a?b=1',
    'http://127.0.0.1:5173/',
    'mailto:ktos@example.com',
    'obsidian://open?path=C%3A%5Cx.md',
  ])('przepuszcza %s', url => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });

  it.each([
    'file:///C:/Users/x/run.bat',
    'file://localhost/C:/x.bat',
    '\\\\serwer\\udzial\\x.exe',
    'ms-settings:privacy',
    'vscode://file/C:/x',
    'obsidian://advanced-uri?commandid=x',
    'javascript:alert(1)',
    'nie-adres',
  ])('odrzuca %s', url => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});

describe('openUrl', () => {
  it('nie otwiera schematu spoza listy', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    openUrl('file:///C:/x.bat');
    expect(open).not.toHaveBeenCalled();
    openUrl('https://example.com');
    expect(open).toHaveBeenCalledWith('https://example.com');
    open.mockRestore();
  });
});
