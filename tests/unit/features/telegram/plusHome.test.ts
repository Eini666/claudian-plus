import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  czytajSekrety,
  domyslnyFolderMostu,
  katalogNarzedzi,
  plikBlokadyMostu,
  plikSekretow,
  zapiszSekrety,
} from '@/features/telegram/plusHome';

describe('plusHome', () => {
  let home: string;
  const TOKEN = '123456:SEKRET-testowy-token';

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-home-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('sciezki leza w <home>/.claudian-plus', () => {
    const plus = path.join(home, '.claudian-plus');
    expect(plikSekretow(home)).toBe(path.join(plus, 'telegram.json'));
    expect(katalogNarzedzi(home)).toBe(path.join(plus, 'bin'));
    expect(domyslnyFolderMostu(home)).toBe(path.join(plus, 'most'));
    expect(plikBlokadyMostu(home)).toBe(path.join(plus, 'most.lock'));
  });

  it('zapis tworzy katalog, odczyt zwraca token i chat id, bez plikow tymczasowych', () => {
    zapiszSekrety({ token: TOKEN, chatId: 987654321 }, home);

    expect(czytajSekrety(home)).toEqual({ token: TOKEN, chatId: 987654321 });
    expect(fs.readdirSync(path.join(home, '.claudian-plus'))).toEqual(['telegram.json']);
  });

  it('nadpisuje istniejace sekrety; chat id przed parowaniem = null', () => {
    zapiszSekrety({ token: TOKEN, chatId: 1 }, home);
    zapiszSekrety({ token: TOKEN, chatId: null }, home);

    expect(czytajSekrety(home)).toEqual({ token: TOKEN, chatId: null });
  });

  it('brak pliku: null', () => {
    expect(czytajSekrety(home)).toBeNull();
  });

  it.each([
    ['uszkodzony JSON', '{"token": "abc'],
    ['brak tokenu', '{"chatId": 5}'],
    ['pusty token', '{"token": "  ", "chatId": 5}'],
    ['chat id nie liczba', '{"token": "abc", "chatId": "5"}'],
    ['null zamiast obiektu', 'null'],
  ])('%s: null bez wyjatku', (_opis, tresc) => {
    fs.mkdirSync(path.join(home, '.claudian-plus'));
    fs.writeFileSync(plikSekretow(home), tresc);

    expect(czytajSekrety(home)).toBeNull();
  });

  it('blad zapisu nie zawiera wartosci tokenu i nie zostawia .tmp', () => {
    // katalog w miejscu pliku: rename musi pasc
    fs.mkdirSync(plikSekretow(home), { recursive: true });

    let komunikat = '';
    try {
      zapiszSekrety({ token: TOKEN, chatId: 1 }, home);
    } catch (err) {
      komunikat = (err as Error).message;
    }

    expect(komunikat).toMatch(/Nie udalo sie zapisac/);
    expect(komunikat).not.toContain(TOKEN);
    expect(komunikat).not.toContain('SEKRET');
    expect(fs.readdirSync(path.join(home, '.claudian-plus'))).toEqual(['telegram.json']);
  });
});
