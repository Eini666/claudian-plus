import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { folderMostu, odbierzWiadomosc } from '@/features/chat/services/ariTelefon';

describe('odbierzWiadomosc', () => {
  let dir: string;
  const flaga = () => path.join(dir, 'poza-domem');
  const wiadomosc = () => path.join(dir, 'wiadomosc.txt');
  const stara = () => path.join(dir, 'ari-wiadomosc.txt');
  const most = (over: Record<string, unknown> = {}) => ({
    telegramBridgeEnabled: true,
    telegramBridgeDir: dir,
    ...over,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ari-telefon-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('most wylaczony: null, pliki nietkniete', () => {
    fs.writeFileSync(flaga(), 'x');
    fs.writeFileSync(wiadomosc(), 'Ari, zrob kawe');

    expect(odbierzWiadomosc(most({ telegramBridgeEnabled: false }))).toBeNull();
    expect(fs.readdirSync(dir).sort()).toEqual(['poza-domem', 'wiadomosc.txt']);
  });

  it('tryb zewnetrzny: zabiera tez stara nazwe ari-wiadomosc.txt', () => {
    fs.writeFileSync(flaga(), 'x');
    fs.writeFileSync(stara(), 'Ari, zrob kawe');

    expect(odbierzWiadomosc(most({ telegramBridgeMode: 'external' }))).toBe('Ari, zrob kawe');
    expect(fs.readdirSync(dir)).toEqual(['poza-domem']);
  });

  it('obie nazwy naraz: jedna wiadomosc w kolejnosci zapisu, rozdzielona pusta linia', () => {
    fs.writeFileSync(flaga(), 'x');
    fs.writeFileSync(wiadomosc(), 'druga');
    fs.writeFileSync(stara(), 'pierwsza');
    fs.utimesSync(stara(), new Date(1_000_000), new Date(1_000_000));

    expect(odbierzWiadomosc(most())).toBe('pierwsza\n\ndruga');
    expect(fs.readdirSync(dir)).toEqual(['poza-domem']);
  });

  it('tryb wbudowany: czyta wiadomosc.txt, starej nazwy nie rusza', () => {
    fs.writeFileSync(flaga(), 'x');
    fs.writeFileSync(wiadomosc(), 'nowa');
    fs.writeFileSync(stara(), 'obca');

    expect(odbierzWiadomosc(most({ telegramBridgeMode: 'builtin' }))).toBe('nowa');
    expect(fs.readdirSync(dir).sort()).toEqual(['ari-wiadomosc.txt', 'poza-domem']);
    expect(odbierzWiadomosc(most({ telegramBridgeMode: 'builtin' }))).toBeNull();
  });

  it('pusty folder w ustawieniach: null', () => {
    expect(odbierzWiadomosc(most({ telegramBridgeDir: '  ' }))).toBeNull();
  });

  it('brak flagi poza-domem: null, wiadomosc zostaje', () => {
    fs.writeFileSync(wiadomosc(), 'Ari, zrob kawe');

    expect(odbierzWiadomosc(most())).toBeNull();
    expect(fs.readFileSync(wiadomosc(), 'utf8')).toBe('Ari, zrob kawe');
  });

  it('flaga + wiadomosc: zwraca tresc, plik usuniety', () => {
    fs.writeFileSync(flaga(), 'x');
    fs.writeFileSync(wiadomosc(), '  Ari, zrob kawe\n');

    expect(odbierzWiadomosc(most())).toBe('Ari, zrob kawe');
    expect(fs.readdirSync(dir)).toEqual(['poza-domem']);
  });

  it('pusta wiadomosc: null, plik usuniety', () => {
    fs.writeFileSync(flaga(), 'x');
    fs.writeFileSync(wiadomosc(), '  \n');

    expect(odbierzWiadomosc(most())).toBeNull();
    expect(fs.readdirSync(dir)).toEqual(['poza-domem']);
  });

  it('folder nie istnieje: null bez wyjatku', () => {
    expect(odbierzWiadomosc(most({ telegramBridgeDir: path.join(dir, 'nie-ma') }))).toBeNull();
  });
});

describe('folderMostu — tryby', () => {
  const home = path.join(os.tmpdir(), 'plus-home-nieistniejacy');

  it('wylaczony: null w kazdym trybie', () => {
    expect(folderMostu({ telegramBridgeEnabled: false, telegramBridgeMode: 'builtin' }, home)).toBeNull();
    expect(folderMostu({ telegramBridgeEnabled: false, telegramBridgeMode: 'external', telegramBridgeDir: 'C:/J' }, home)).toBeNull();
  });

  it('wbudowany bez folderu: <home>/.claudian-plus/most', () => {
    expect(folderMostu({ telegramBridgeEnabled: true, telegramBridgeMode: 'builtin', telegramBridgeDir: ' ' }, home))
      .toBe(path.join(home, '.claudian-plus', 'most'));
  });

  it('wbudowany z wlasnym folderem: ten folder', () => {
    expect(folderMostu({ telegramBridgeEnabled: true, telegramBridgeMode: 'builtin', telegramBridgeDir: ' C:/Most ' }, home))
      .toBe('C:/Most');
  });

  it('zewnetrzny: folder z ustawien, bez folderu null', () => {
    expect(folderMostu({ telegramBridgeEnabled: true, telegramBridgeMode: 'external', telegramBridgeDir: 'C:/JARVIS/_out' }, home))
      .toBe('C:/JARVIS/_out');
    expect(folderMostu({ telegramBridgeEnabled: true, telegramBridgeMode: 'external', telegramBridgeDir: '' }, home)).toBeNull();
  });
});
