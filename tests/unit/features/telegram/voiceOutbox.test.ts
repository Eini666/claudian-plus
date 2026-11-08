import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { przetworzGlosowki } from '@/features/telegram/voiceOutbox';

describe('przetworzGlosowki', () => {
  let dir: string;
  let ogg: string;
  const syntezuj = jest.fn<Promise<string>, [string]>();
  const wyslijGlos = jest.fn<Promise<void>, [string, string?]>();

  const zostaw = (rdzen: string, tekst: string) => fs.writeFileSync(path.join(dir, `glosowka-${rdzen}.txt`), tekst, 'utf8');
  const wynik = (rdzen: string) => fs.readFileSync(path.join(dir, `glosowka-${rdzen}.wynik`), 'utf8');
  const pozaDomem = () => fs.writeFileSync(path.join(dir, 'poza-domem'), '2026-11-08T10:00:00.000Z');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-most-'));
    ogg = path.join(dir, 'atrapa.ogg');
    syntezuj.mockReset().mockImplementation(async () => { fs.writeFileSync(ogg, 'OggS'); return ogg; });
    wyslijGlos.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('poza domem: synteza, wysyłka z podpisem, OGG usunięty, wynik „wysłano” i flaga czeka', async () => {
    pozaDomem();
    zostaw('ab12cd', 'Etap pierwszy gotowy.');

    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });

    expect(syntezuj).toHaveBeenCalledWith('Etap pierwszy gotowy.');
    expect(wyslijGlos).toHaveBeenCalledWith(ogg, 'Etap pierwszy gotowy.');
    expect(fs.existsSync(ogg)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'glosowka-ab12cd.txt'))).toBe(false);
    expect(wynik('ab12cd')).toBe('wysłano');
    expect(Number(fs.readFileSync(path.join(dir, 'czeka'), 'utf8'))).toBeGreaterThan(0);
    expect(fs.readdirSync(dir).sort()).toEqual(['czeka', 'glosowka-ab12cd.wynik', 'poza-domem']);
  });

  it('tryb domowy: nic nie wychodzi, wynik „tryb domowy”', async () => {
    zostaw('dom123', 'Gotowe.');

    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });

    expect(syntezuj).not.toHaveBeenCalled();
    expect(wyslijGlos).not.toHaveBeenCalled();
    expect(wynik('dom123')).toBe('tryb domowy');
    expect(fs.existsSync(path.join(dir, 'czeka'))).toBe(false);
  });

  it('błąd syntezy: opis w wyniku, plik nie wraca do kolejki', async () => {
    pozaDomem();
    zostaw('err001', 'Coś do powiedzenia.');
    syntezuj.mockRejectedValue(new Error('Piper niezainstalowany'));

    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });
    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });

    expect(syntezuj).toHaveBeenCalledTimes(1);
    expect(wyslijGlos).not.toHaveBeenCalled();
    expect(wynik('err001')).toBe('błąd: Piper niezainstalowany');
    expect(fs.existsSync(path.join(dir, 'glosowka-err001.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'czeka'))).toBe(false);
  });

  it('błąd wysyłki: OGG i tak usunięty', async () => {
    pozaDomem();
    zostaw('err002', 'Tekst.');
    wyslijGlos.mockRejectedValue(new Error('Telegram sendVoice: brak połączenia'));

    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });

    expect(wynik('err002')).toBe('błąd: Telegram sendVoice: brak połączenia');
    expect(fs.existsSync(ogg)).toBe(false);
  });

  it('tekst ponad 1024 znaki: głosówka bez podpisu', async () => {
    pozaDomem();
    zostaw('dlugi1', 'a'.repeat(1500));

    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });

    expect(wyslijGlos).toHaveBeenCalledWith(ogg, undefined);
    expect(wynik('dlugi1')).toBe('wysłano');
  });

  it('sprząta wyniki starsze niż godzina, świeże zostawia', async () => {
    const stary = path.join(dir, 'glosowka-stary1.wynik');
    const swiezy = path.join(dir, 'glosowka-swiez1.wynik');
    fs.writeFileSync(stary, 'wysłano');
    fs.writeFileSync(swiezy, 'wysłano');
    const dwieGodzinyTemu = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stary, dwieGodzinyTemu, dwieGodzinyTemu);

    await przetworzGlosowki(dir, { syntezuj, wyslijGlos });

    expect(fs.existsSync(stary)).toBe(false);
    expect(fs.existsSync(swiezy)).toBe(true);
  });

  it('brak folderu mostu: nie rzuca', async () => {
    await expect(przetworzGlosowki(path.join(dir, 'nie-ma'), { syntezuj, wyslijGlos })).resolves.toBeUndefined();
  });
});
