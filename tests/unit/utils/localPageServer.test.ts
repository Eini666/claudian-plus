import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import {
  fileForPagePath,
  fileUrlToPath,
  localPageUrl,
  pagePathFor,
  stopLocalPageServer,
} from '@/utils/localPageServer';

const get = (url: string) => new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }));
  }).on('error', reject);
});

describe('adresy lokalnych stron', () => {
  it('sciezka ze spacja i polskimi znakami tam i z powrotem', () => {
    const abs = 'C:\\Users\\Jan\\Music\\Moj projekt\\docs\\łąka.html';
    const p = pagePathFor('k1', abs);
    expect(p).toBe('/k1/C:/Users/Jan/Music/Moj%20projekt/docs/%C5%82%C4%85ka.html');
    expect(fileForPagePath('k1', p)).toBe(abs);
  });

  it('wzgledny zasob strony trafia obok pliku', () => {
    expect(fileForPagePath('k1', '/k1/C:/proj/docs/mockups/../../app/font.ttf')).toBe('C:\\proj\\app\\font.ttf');
  });

  it('obcy klucz, brak dysku i smieci → null', () => {
    expect(fileForPagePath('k1', '/zly/C:/x.html')).toBeNull();
    expect(fileForPagePath('k1', '/k1/x.html')).toBeNull();
    expect(fileForPagePath('k1', '/k1/%E0%A4%A')).toBeNull();
  });

  it('file:/// → sciezka Windows; inne adresy → null', () => {
    expect(fileUrlToPath('file:///C:/Users/Jan/Music/Moj%20projekt/a.html')).toBe('C:\\Users\\Jan\\Music\\Moj projekt\\a.html');
    expect(fileUrlToPath('http://localhost/a.html')).toBeNull();
  });
});

describe('serwer', () => {
  afterAll(() => stopLocalPageServer());

  it('podaje plik z dobrym typem, a obcy klucz i katalog dostaja 404', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lps-'));
    const file = path.join(dir, 'strona testowa.html');
    fs.writeFileSync(file, '<h1>ok</h1>');
    try {
      const url = await localPageUrl(file);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{24}\/[A-Z]:\//);
      const ok = await get(url);
      expect(ok.status).toBe(200);
      expect(ok.type).toContain('text/html');
      expect(ok.body).toBe('<h1>ok</h1>');

      const origin = new URL(url).origin;
      expect((await get(`${origin}/zlyklucz/${file.replace(/\\/g, '/')}`)).status).toBe(404);
      expect((await get(url.replace(/\/[^/]+$/, ''))).status).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
