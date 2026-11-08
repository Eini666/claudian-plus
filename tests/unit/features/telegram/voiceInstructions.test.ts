import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { dopiskGlosowki, instrukcjaGlosowek } from '@/features/telegram/voiceInstructions';

describe('instrukcjaGlosowek', () => {
  let home: string;
  let most: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-home-'));
    most = path.join(home, '.claudian-plus', 'most');
    fs.mkdirSync(most, { recursive: true });
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const builtin = { telegramBridgeEnabled: true, telegramBridgeMode: 'builtin', telegramBridgeDir: '' };

  it('builtin + poza domem: instrukcja z prawdziwą ścieżką folderu mostu', () => {
    fs.writeFileSync(path.join(most, 'poza-domem'), 'x');

    const tekst = instrukcjaGlosowek(builtin, home);

    expect(tekst).toContain('Użytkownik jest poza domem i NIE widzi ekranu.');
    expect(tekst).toContain(`${most}${path.sep}glosowka-<6 losowych liter lub cyfr>.txt`);
    expect(tekst).toContain('Wynik „tryb domowy” = głosówka nie poszła');
  });

  it('własny folder mostu trafia do instrukcji', () => {
    const wlasny = path.join(home, 'wlasny');
    fs.mkdirSync(wlasny);
    fs.writeFileSync(path.join(wlasny, 'poza-domem'), 'x');

    expect(instrukcjaGlosowek({ ...builtin, telegramBridgeDir: wlasny }, home)).toContain(`${wlasny}${path.sep}glosowka-`);
  });

  it('bez flagi poza-domem: brak instrukcji', () => {
    expect(instrukcjaGlosowek(builtin, home)).toBeNull();
  });

  it('tryb external albo most wyłączony: brak instrukcji mimo flagi', () => {
    const wlasny = path.join(home, 'jarvis');
    fs.mkdirSync(wlasny);
    fs.writeFileSync(path.join(wlasny, 'poza-domem'), 'x');
    fs.writeFileSync(path.join(most, 'poza-domem'), 'x');

    expect(instrukcjaGlosowek({ ...builtin, telegramBridgeMode: 'external', telegramBridgeDir: wlasny }, home)).toBeNull();
    expect(instrukcjaGlosowek({ ...builtin, telegramBridgeEnabled: false }, home)).toBeNull();
  });

  it('dopisek do wiadomości [Telegram]: ścieżka folderu, tylko builtin + poza domem', () => {
    expect(dopiskGlosowki(builtin, home)).toBeNull();
    fs.writeFileSync(path.join(most, 'poza-domem'), 'x');

    expect(dopiskGlosowki(builtin, home)).toContain(`${most}${path.sep}glosowka-<6 losowych znaków>.txt`);
    expect(dopiskGlosowki({ ...builtin, telegramBridgeMode: 'external' }, home)).toBeNull();
  });
});
