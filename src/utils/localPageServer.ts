/**
 * Lokalne strony (makiety HTML) we wbudowanej przegladarce Obsidiana. Jej widok `webviewer`
 * laduje WYLACZNIE `http(s)://` (Obsidian 1.14.5, fn `navigate`) — `file:///` odrzuca po cichu.
 * Dlatego plik dostaje adres `http://127.0.0.1:<port>/<klucz>/C:/sciezka/plik.html`: sciezka w adresie
 * to sciezka na dysku, wiec wzgledne odwolania strony (`../font/x.ttf`) dzialaja bez zmian.
 *
 * Granice: tylko 127.0.0.1, tylko GET/HEAD, tylko istniejace pliki (bez listingu katalogow),
 * losowy klucz per projekt strony ([findPageRoot]) — skrypt strony zna swoj klucz z adresu,
 * wiec klucz otwiera tylko jej projekt, bez katalogow i plikow z sekretami ([isServable]).
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', txt: 'text/plain; charset=utf-8',
};

/** `C:\a b\x.html` → `/<klucz>/C:/a%20b/x.html`. */
export function pagePathFor(token: string, absPath: string): string {
  const segments = absPath.replace(/\\/g, '/').split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s)));
  return `/${token}/${segments.join('/')}`;
}

/** Odwrotnosc [pagePathFor]; obcy klucz, sciezka wzgledna albo `..` → null. */
export function fileForPagePath(token: string, urlPath: string): string | null {
  const prefix = `/${token}/`;
  if (!urlPath.startsWith(prefix)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(urlPath.slice(prefix.length).split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (!/^[A-Za-z]:\//.test(rest)) return null;
  const abs = path.win32.normalize(rest);
  // normalize zjada `..`; ten sam dysk na poczatku = nie ucieklismy poza absolutna sciezke
  return abs.slice(0, 2).toLowerCase() === rest.slice(0, 2).toLowerCase() ? abs : null;
}

/** `file:///C:/a%20b/x.html` → `C:\a b\x.html`; inne adresy → null. */
export function fileUrlToPath(url: string): string | null {
  const m = /^file:\/\/\/([A-Za-z]:\/.*)$/i.exec(url.trim());
  if (!m) return null;
  try {
    return path.win32.normalize(decodeURIComponent(m[1].split('#')[0].split('?')[0]));
  } catch {
    return null;
  }
}

/**
 * Granica plikow, ktore strona moze pobrac: najblizszy folder projektu (`.git`, `package.json`,
 * folder konfiguracji vaulta), zeby `../font/x.ttf` dzialal. Znacznik w katalogu domowym albo
 * na dysku nie liczy sie — wtedy sam folder pliku, inaczej klucz otwieralby caly dom z `~/.claude`.
 */
export function findPageRoot(
  dir: string,
  vaultConfigDir: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const markers = ['.git', 'package.json', vaultConfigDir];
  const start = path.win32.normalize(dir);
  const home = path.win32.normalize(os.homedir()).toLowerCase();
  for (let cur = start; ; cur = path.win32.dirname(cur)) {
    const parent = path.win32.dirname(cur);
    if (parent === cur || cur.toLowerCase() === home) return start;
    if (markers.some(m => exists(path.win32.join(cur, m)))) return cur;
  }
}

const DENIED_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.claudian-plus', 'appdata']);
const DENIED_FILE = /^(?:\.env(?:\..*)?|\.credentials\.json|\.claude\.json|id_[a-z0-9]+)$/i;

/** Plik w korzeniu i poza katalogami/plikami z sekretami (sprawdzane ponizej korzenia). */
export function isServable(root: string, file: string): boolean {
  const rel = path.win32.relative(root, file);
  if (!rel || rel.startsWith('..') || path.win32.isAbsolute(rel)) return false;
  const parts = rel.split('\\');
  if (DENIED_FILE.test(parts[parts.length - 1])) return false;
  return !parts.slice(0, -1).some(p => DENIED_DIRS.has(p.toLowerCase()));
}

let server: http.Server | null = null;
let base: Promise<string> | null = null;
// klucz → korzen; jeden klucz na projekt, wiec strona z jednego projektu nie czyta drugiego
const roots = new Map<string, string>();

function tokenForRoot(root: string): string {
  for (const [token, r] of roots) if (r.toLowerCase() === root.toLowerCase()) return token;
  const token = randomBytes(12).toString('hex');
  roots.set(token, root);
  return token;
}

function resolveRequest(urlPath: string): string | null {
  const token = urlPath.split('/')[1] ?? '';
  const root = roots.get(token);
  const file = root ? fileForPagePath(token, urlPath) : null;
  return root && file && isServable(root, file) ? file : null;
}

function start(): Promise<string> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const file = req.method === 'GET' || req.method === 'HEAD' ? resolveRequest(req.url ?? '') : null;
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const ext = path.win32.extname(file).slice(1).toLowerCase();
      // no-store: po poprawce makiety przeladowanie ma pokazac nowa wersje, nie cache
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      server = srv;
      resolve(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
    });
  });
}

/** Adres http lokalnego pliku; serwer wstaje przy pierwszym uzyciu. */
export async function localPageUrl(absPath: string, vaultConfigDir: string): Promise<string> {
  base ??= start().catch((err: unknown) => {
    base = null;
    throw err;
  });
  return (await base) + pagePathFor(tokenForRoot(findPageRoot(path.win32.dirname(absPath), vaultConfigDir)), absPath);
}

export function stopLocalPageServer(): void {
  server?.close();
  server = null;
  base = null;
  roots.clear();
}
