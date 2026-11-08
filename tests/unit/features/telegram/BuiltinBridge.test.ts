import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BuiltinBridge, type UstawieniaMostu } from '@/features/telegram/BuiltinBridge';
import { katalogNarzedzi, zapiszSekrety } from '@/features/telegram/plusHome';
import type { ObslugaTelegrama } from '@/features/telegram/TelegramClient';

describe('BuiltinBridge', () => {
  let home: string;
  let ustawienia: UstawieniaMostu;
  let most: BuiltinBridge;
  // getUpdates wisi do abortu — zadne zapytanie nie wychodzi poza test
  const fetchMock = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-home-'));
    ustawienia = { telegramBridgeEnabled: true, telegramBridgeMode: 'builtin', telegramBridgeDir: '' };
    fetchMock.mockClear();
    most = new BuiltinBridge(() => ustawienia, { home, fetch: fetchMock as unknown as typeof fetch, log: jest.fn() });
  });
  afterEach(() => {
    most.stop();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('tryb external: klient nie startuje', () => {
    zapiszSekrety({ token: '1:x', chatId: 5 }, home);
    ustawienia.telegramBridgeMode = 'external';
    expect(most.odswiez()).toBe('wylaczony');
    expect(most.klient.dziala).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tryb external: skrzynka głosówek nie zabiera plików, prompt bez instrukcji', async () => {
    zapiszSekrety({ token: '1:x', chatId: 5 }, home);
    const dir = path.join(home, 'jarvis');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'poza-domem'), 'x');
    fs.writeFileSync(path.join(dir, 'glosowka-abc123.txt'), 'Tekst JARVIS-a');
    ustawienia = { telegramBridgeEnabled: true, telegramBridgeMode: 'external', telegramBridgeDir: dir };

    most.odswiez();
    await most.oproznijSkrzynke();

    expect(fs.readdirSync(dir).sort()).toEqual(['glosowka-abc123.txt', 'poza-domem']);
    expect(most.instrukcjaGlosowek()).toBeNull();
  });

  it('builtin bez tokenu: nie startuje i nie rzuca', () => {
    expect(most.odswiez()).toBe('brak-tokenu');
    expect(most.klient.dziala).toBe(false);
  });

  it('builtin z tokenem startuje; wyłączenie mostu w ustawieniach go zatrzymuje', () => {
    zapiszSekrety({ token: '1:x', chatId: 5 }, home);
    expect(most.odswiez()).toBe('dziala');
    expect(most.klient.dziala).toBe(true);
    ustawienia.telegramBridgeEnabled = false;
    expect(most.odswiez()).toBe('wylaczony');
    expect(most.klient.dziala).toBe(false);
  });

  it('świeża cudza blokada (Ctrl+R bez onunload): ponowienie po 30 s startuje bota, gdy wygaśnie', () => {
    jest.useFakeTimers();
    try {
      zapiszSekrety({ token: '1:x', chatId: 5 }, home);
      const blokada = path.join(home, '.claudian-plus', 'most.lock');
      fs.writeFileSync(blokada, JSON.stringify({ pid: 1, wlasciciel: 'stara-instancja', ts: Date.now() }));
      expect(most.odswiez()).toBe('zajete');
      expect(most.klient.dziala).toBe(false);

      fs.writeFileSync(blokada, JSON.stringify({ pid: 1, wlasciciel: 'stara-instancja', ts: Date.now() - 120_000 }));
      jest.advanceTimersByTime(30_000);

      expect(most.klient.dziala).toBe(true);
    } finally {
      most.stop();
      jest.useRealTimers();
    }
  });

  (process.platform === 'win32' && process.arch === 'x64' ? describe : describe.skip)('rozpoznawanie mowy', () => {
    const polozAtrape = (wzgledna: string): void => {
      const plik = path.join(katalogNarzedzi(home), wzgledna);
      fs.mkdirSync(path.dirname(plik), { recursive: true });
      fs.writeFileSync(plik, 'x');
    };
    const obslugaStartu = (spy: jest.SpyInstance): ObslugaTelegrama => spy.mock.calls.at(-1)![0] as ObslugaTelegrama;

    beforeEach(() => zapiszSekrety({ token: '1:x', chatId: 5 }, home));

    it('brak whispera: klient startuje bez transkrybuj', () => {
      const spy = jest.spyOn(most.klient, 'start');
      expect(most.odswiez()).toBe('dziala');
      expect(obslugaStartu(spy).transkrybuj).toBeUndefined();
    });

    it('whisper + wybrany model + ffmpeg: po odświeżeniu klient restartuje z transkrybuj', () => {
      ustawienia.whisperModel = 'small';
      const spy = jest.spyOn(most.klient, 'start');
      most.odswiez();
      const stop = jest.spyOn(most.klient, 'stop');
      polozAtrape('whisper/whisper-cli.exe');
      polozAtrape('modele-mowy/small/ggml-small-q5_1.bin');
      polozAtrape('ffmpeg/ffmpeg.exe');

      expect(most.odswiez()).toBe('dziala');
      expect(stop).toHaveBeenCalled();
      expect(obslugaStartu(spy).transkrybuj).toBeInstanceOf(Function);

      // Zmiana na niezainstalowany model: znowu bez transkrybuj
      ustawienia.whisperModel = 'large-v3-turbo';
      most.odswiez();
      expect(obslugaStartu(spy).transkrybuj).toBeUndefined();
    });

    it('obsluz z głosówki trafia do routera z zGlosu', async () => {
      const dir = path.join(home, 'most');
      ustawienia.telegramBridgeDir = dir;
      const spy = jest.spyOn(most.klient, 'start');
      most.odswiez();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'poza-domem'), 'x');
      const odp = await obslugaStartu(spy).obsluz('kup mleko', { zGlosu: true, kiedy: new Date() });
      expect(odp).toBe('Przekazane do Claude: „kup mleko”');
      expect(fs.readFileSync(path.join(dir, 'wiadomosc.txt'), 'utf8')).toBe('kup mleko');
    });
  });
});
