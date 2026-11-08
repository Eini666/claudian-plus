import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { odbierzWiadomosc } from '@/features/chat/services/ariTelefon';
import { flagaCzeka, obsluzWiadomosc, tekstyMostu } from '@/features/telegram/bridgeRouter';

const TERAZ = 1_800_000_000_000;
const T = tekstyMostu('Claude');

describe('bridgeRouter', () => {
  let dir: string;
  const flaga = () => path.join(dir, 'poza-domem');
  const plik = () => path.join(dir, 'wiadomosc.txt');
  const wyslij = (tekst: string, kiedy = new Date(TERAZ - 1000)) =>
    obsluzWiadomosc(tekst, { dir, name: 'Claude', kiedy, teraz: TERAZ });

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'most-')), 'most');
  });
  afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

  it('„Wychodzą!" (przekręcone przez whisper) tworzy flagę poza domem', () => {
    expect(wyslij('Wychodzą!')).toBe('Tryb poza domem: Claude będzie raportować głosówkami.');
    expect(fs.existsSync(flaga())).toBe(true);
  });

  it('„wróciłem" usuwa flagę; bez flagi też odpowiada', () => {
    wyslij('wychodzę');
    expect(wyslij('wróciłem')).toBe('Tryb domowy: Claude pisze tylko na ekranie.');
    expect(fs.existsSync(flaga())).toBe(false);
    expect(wyslij('Wróciłam.')).toBe(T.domowy);
  });

  it('tryb domowy: zwykła wiadomość odrzucona, plik nietknięty', () => {
    expect(wyslij('zrób X')).toBe('Tryb domowy — Claude nie odbiera z telefonu. Napisz „wychodzę”, żeby to zmienić.');
    expect(fs.existsSync(plik())).toBe(false);
  });

  it('poza domem: każda wiadomość idzie do pliku, nie tylko z nazwą', () => {
    wyslij('wychodzę');
    expect(wyslij('nowy temat: zrób X')).toBe('Przekazane do Claude.');
    expect(fs.readFileSync(plik(), 'utf8')).toBe('nowy temat: zrób X');
  });

  it('wbudowany bot pisze nowe nazwy: wiadomosc.txt i czeka, nigdy starych', () => {
    expect(path.basename(flagaCzeka(dir))).toBe('czeka');
    wyslij('wychodzę');
    wyslij('zrób X');
    expect(fs.readdirSync(dir).sort()).toEqual(['poza-domem', 'wiadomosc.txt']);
  });

  it('świeże czeka w trybie domowym przepuszcza jedną wiadomość i jest zużywane', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(flagaCzeka(dir), String(TERAZ - 60_000));
    expect(wyslij('tak, rób')).toBe(T.przyjeta);
    expect(fs.existsSync(flagaCzeka(dir))).toBe(false);
    expect(wyslij('a jeszcze to')).toBe(T.odmowa);
    expect(fs.readFileSync(plik(), 'utf8')).toBe('tak, rób');
  });

  it('czeka starsze niż godzina działa jak brak (i też jest usuwane)', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(flagaCzeka(dir), String(TERAZ - 61 * 60_000));
    expect(wyslij('tak')).toBe(T.odmowa);
    expect(fs.existsSync(flagaCzeka(dir))).toBe(false);
    expect(fs.existsSync(plik())).toBe(false);
  });

  it('dwie wiadomości przed odbiorem: obie w pliku, rozdzielone pustą linią; karta odbiera całość', () => {
    wyslij('wychodzę');
    wyslij('pierwsza');
    wyslij('druga');
    expect(fs.readFileSync(plik(), 'utf8')).toBe('pierwsza\n\ndruga');
    expect(odbierzWiadomosc({ telegramBridgeEnabled: true, telegramBridgeDir: dir })).toBe('pierwsza\n\ndruga');
  });

  it('nazwa asystenta na początku jest zdejmowana (bez względu na wielkość liter)', () => {
    wyslij('wychodzę');
    wyslij('Claude, zrób X');
    wyslij('claude: i Y');
    wyslij('Claudette zostaje');
    expect(fs.readFileSync(plik(), 'utf8')).toBe('zrób X\n\ni Y\n\nClaudette zostaje');
  });

  it('samo „Claude," → prośba o treść, plik nietknięty', () => {
    wyslij('wychodzę');
    expect(wyslij('Claude,')).toBe('Słucham — napisz, co Claude ma zrobić.');
    expect(fs.existsSync(plik())).toBe(false);
  });

  it('wiadomość sprzed 6 min nie trafia do pliku i nie zużywa czeka', () => {
    wyslij('wychodzę');
    fs.writeFileSync(flagaCzeka(dir), String(TERAZ - 60_000));
    expect(wyslij('stara', new Date(TERAZ - 6 * 60_000))).toBe(
      'Ta wiadomość przyszła, gdy Obsidian był wyłączony. Wyślij ją jeszcze raz, jeśli nadal aktualna.',
    );
    expect(fs.existsSync(plik())).toBe(false);
    expect(fs.existsSync(flagaCzeka(dir))).toBe(true);
  });

  it('błąd zapisu → tekst błędu bez ścieżki', () => {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'plik zamiast folderu');
    const odp = wyslij('wychodzę');
    expect(odp).toBe('Nie udało się przekazać wiadomości — spróbuj za chwilę.');
    expect(odp).not.toContain(dir);
  });

  describe('głosówka (zGlosu)', () => {
    const glosem = (tekst: string) =>
      obsluzWiadomosc(tekst, { dir, name: 'Claude', kiedy: new Date(TERAZ - 1000), teraz: TERAZ, zGlosu: true });

    it('transkrypcja trafia do pliku, odpowiedź pokazuje usłyszany tekst', () => {
      wyslij('wychodzę');
      expect(glosem('kup mleko')).toBe('Przekazane do Claude: „kup mleko”');
      expect(fs.readFileSync(plik(), 'utf8')).toBe('kup mleko');
    });

    it('pusta transkrypcja: nic do pliku, czeka nietknięte', () => {
      wyslij('wychodzę');
      fs.writeFileSync(flagaCzeka(dir), String(TERAZ - 60_000));
      expect(glosem('  ')).toBe('Nie usłyszałam nic wyraźnego — powtórz albo napisz tekstem.');
      expect(fs.existsSync(plik())).toBe(false);
      expect(fs.existsSync(flagaCzeka(dir))).toBe(true);
    });

    it('„Wychodzę." głosem włącza tryb poza domem', () => {
      expect(glosem('Wychodzę.')).toBe(T.pozaDomem);
      expect(fs.existsSync(flaga())).toBe(true);
    });
  });
});
