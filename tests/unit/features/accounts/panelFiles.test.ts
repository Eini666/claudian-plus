import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { katalogPanelu, wersjaPanelu, zapiszPlikiPanelu } from '@/features/accounts/panelFiles';

describe('panelFiles', () => {
  let home: string;
  const pliki = { mjs: 'const PANEL_VERSION = 3\n', html: '<html></html>' };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-panel-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('katalog lezy w <home>/.claudian-plus/accounts', () => {
    expect(katalogPanelu(home)).toBe(path.join(home, '.claudian-plus', 'accounts'));
  });

  it('pierwszy zapis kladzie oba pliki obok siebie i skrot', () => {
    const { katalog, zmienione } = zapiszPlikiPanelu(home, pliki);
    expect(zmienione).toBe(true);
    expect(fs.readFileSync(path.join(katalog, 'accounts.mjs'), 'utf8')).toBe(pliki.mjs);
    expect(fs.readFileSync(path.join(katalog, 'panel.html'), 'utf8')).toBe(pliki.html);
    expect(fs.readFileSync(path.join(katalog, '.wersja'), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readdirSync(katalog).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('ta sama tresc nie dotyka dysku, inna zapisuje ponownie', () => {
    const { katalog } = zapiszPlikiPanelu(home, pliki);
    const mjs = path.join(katalog, 'accounts.mjs');
    const dawno = new Date(Date.now() - 60_000);
    fs.utimesSync(mjs, dawno, dawno);

    expect(zapiszPlikiPanelu(home, pliki).zmienione).toBe(false);
    expect(fs.statSync(mjs).mtimeMs).toBe(dawno.getTime());

    expect(zapiszPlikiPanelu(home, { ...pliki, html: '<html>2</html>' }).zmienione).toBe(true);
    expect(fs.readFileSync(path.join(katalog, 'panel.html'), 'utf8')).toBe('<html>2</html>');
  });

  it('skasowany plik serwera wraca mimo zgodnego skrotu', () => {
    const { katalog } = zapiszPlikiPanelu(home, pliki);
    fs.rmSync(path.join(katalog, 'accounts.mjs'));
    expect(zapiszPlikiPanelu(home, pliki).zmienione).toBe(true);
    expect(fs.existsSync(path.join(katalog, 'accounts.mjs'))).toBe(true);
  });

  it('czyta PANEL_VERSION z tresci serwera', () => {
    expect(wersjaPanelu(pliki.mjs)).toBe(3);
    expect(wersjaPanelu('')).toBeNull();
  });
});
