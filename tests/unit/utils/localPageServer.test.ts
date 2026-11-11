import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import {
  fileForPagePath,
  fileUrlToPath,
  findPageRoot,
  isServable,
  localPageUrl,
  pagePathFor,
  stopLocalPageServer,
} from '@/utils/localPageServer';

const CFG = 'cfg-vaulta';

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
      const url = await localPageUrl(file, CFG);
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

  it('klucz strony otwiera tylko jej projekt: ../ w projekcie tak, plik obok projektu i sekrety nie', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lps-'));
    const proj = path.join(dir, 'proj');
    fs.mkdirSync(path.join(proj, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'font'));
    fs.mkdirSync(path.join(proj, '.ssh'));
    fs.writeFileSync(path.join(proj, 'package.json'), '{}');
    fs.writeFileSync(path.join(proj, 'docs', 'makieta.html'), '<h1>m</h1>');
    fs.writeFileSync(path.join(proj, 'font', 'x.ttf'), 'ttf');
    fs.writeFileSync(path.join(proj, '.env'), 'SEKRET=1');
    fs.writeFileSync(path.join(proj, '.ssh', 'id_rsa'), 'klucz');
    fs.writeFileSync(path.join(dir, 'obok.txt'), 'poza projektem');
    try {
      const url = await localPageUrl(path.join(proj, 'docs', 'makieta.html'), CFG);
      const u = new URL(url);
      const base = `${u.origin}/${u.pathname.split('/')[1]}`;
      const at = (p: string) => `${base}/${p.replace(/\\/g, '/')}`;

      expect((await get(url)).status).toBe(200);
      expect((await get(at(path.join(proj, 'font', 'x.ttf')))).status).toBe(200);
      expect((await get(at(path.join(dir, 'obok.txt')))).status).toBe(404);
      expect((await get(at(path.join(proj, '.env')))).status).toBe(404);
      expect((await get(at(path.join(proj, '.ssh', 'id_rsa')))).status).toBe(404);
      expect((await get(url)).type).toContain('text/html');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('korzen strony', () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);

  it('najblizszy folder z .git / package.json / konfiguracja vaulta', () => {
    expect(findPageRoot('C:\\proj\\docs\\mock', CFG, exists(['C:\\proj\\.git']))).toBe('C:\\proj');
    expect(findPageRoot('C:\\v\\Zasoby', CFG, exists([`C:\\v\\${CFG}`]))).toBe('C:\\v');
  });

  it('bez znacznika albo znacznik w katalogu domowym / na dysku → folder pliku', () => {
    expect(findPageRoot('C:\\x\\y', CFG, exists([]))).toBe('C:\\x\\y');
    expect(findPageRoot('C:\\x\\y', CFG, exists(['C:\\.git']))).toBe('C:\\x\\y');
    const home = os.homedir();
    expect(findPageRoot(path.join(home, 'Desktop'), CFG, exists([path.join(home, 'package.json')])))
      .toBe(path.join(home, 'Desktop'));
  });

  it('isServable: w korzeniu tak, poza nim i sekrety nie', () => {
    expect(isServable('C:\\proj', 'C:\\proj\\a\\b.css')).toBe(true);
    expect(isServable('C:\\proj', 'C:\\PROJ\\a.css')).toBe(true);
    expect(isServable('C:\\proj', 'C:\\proj2\\a.css')).toBe(false);
    expect(isServable('C:\\proj', 'C:\\proj\\.claudian-plus\\telegram.json')).toBe(false);
    expect(isServable('C:\\proj', 'C:\\proj\\x\\.credentials.json')).toBe(false);
    expect(isServable('C:\\proj', 'C:\\proj\\.env.local')).toBe(false);
  });
});
