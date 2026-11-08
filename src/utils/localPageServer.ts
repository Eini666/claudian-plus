/**
 * Lokalne strony (makiety HTML) we wbudowanej przegladarce Obsidiana. Jej widok `webviewer`
 * laduje WYLACZNIE `http(s)://` (Obsidian 1.14.5, fn `navigate`) — `file:///` odrzuca po cichu.
 * Dlatego plik dostaje adres `http://127.0.0.1:<port>/<klucz>/C:/sciezka/plik.html`: sciezka w adresie
 * to sciezka na dysku, wiec wzgledne odwolania strony (`../font/x.ttf`) dzialaja bez zmian.
 *
 * Granice: tylko 127.0.0.1, tylko GET/HEAD, tylko istniejace pliki (bez listingu katalogow),
 * losowy klucz na kazde uruchomienie wtyczki — obca strona w przegladarce nie zgadnie adresu.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
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

let server: http.Server | null = null;
let base: Promise<string> | null = null;
const token = randomBytes(12).toString('hex');

function start(): Promise<string> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const file = req.method === 'GET' || req.method === 'HEAD' ? fileForPagePath(token, req.url ?? '') : null;
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const ext = path.win32.extname(file).slice(1).toLowerCase();
      // no-store: po poprawce makiety przeladowanie ma pokazac nowa wersje, nie cache
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
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
export async function localPageUrl(absPath: string): Promise<string> {
  base ??= start().catch((err: unknown) => {
    base = null;
    throw err;
  });
  return (await base) + pagePathFor(token, absPath);
}

export function stopLocalPageServer(): void {
  server?.close();
  server = null;
  base = null;
}
