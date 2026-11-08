import * as childProcess from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

import { katalogNarzedzi } from '@/features/telegram/plusHome';
import type { Narzedzie } from '@/features/telegram/voiceCatalog';
import { stan, syntezuj, zainstaluj } from '@/features/telegram/voiceTools';

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn() }));

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const naWindows = process.platform === 'win32';

function ustawPlatforme(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
}

describe('voiceTools', () => {
  const prawdziwa = { platform: process.platform, arch: process.arch };
  let home: string;
  const glos = Buffer.from('atrapa-modelu-onnx');
  const katalogGlosu = (suma: string): Record<string, Narzedzie> => ({
    'pl_PL-gosia-medium': {
      cel: 'glosy/pl_PL-gosia-medium',
      sprawdz: 'pl_PL-gosia-medium.onnx',
      pliki: [{ nazwa: 'pl_PL-gosia-medium.onnx', url: 'https://x/onnx', rozmiar: glos.length, sha256: suma }],
    },
  });

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-voice-'));
    ustawPlatforme('win32', 'x64');
    (childProcess.spawn as jest.Mock).mockReset();
  });

  afterEach(() => {
    ustawPlatforme(prawdziwa.platform, prawdziwa.arch);
    fs.rmSync(home, { recursive: true, force: true });
  });

  const bin = (): string[] => (fs.existsSync(katalogNarzedzi(home)) ? fs.readdirSync(katalogNarzedzi(home)) : []);

  it('stan() na pustym katalogu: nic nie zainstalowane', () => {
    expect(stan(home)).toEqual({
      obslugiwane: true,
      piper: null,
      ffmpeg: null,
      glosy: { 'pl_PL-gosia-medium': null, 'pl_PL-darkman-medium': null, 'pl_PL-mc_speech-medium': null },
      whisper: null,
      modeleMowy: { 'large-v3-turbo': null, small: null },
    });
  });

  it('model mowy z prawdziwego katalogu: zly plik odrzucony, nic nie zostaje', async () => {
    const otworz = jest.fn(async () => Readable.from([glos]));
    await expect(zainstaluj('small', undefined, home, { otworz })).rejects.toThrow('Niezgodna suma SHA-256');
    expect(otworz).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/huggingface\.co\/.+\/ggml-small-q5_1\.bin$/));
    expect(bin()).toEqual([]);
    expect(stan(home)).toMatchObject({ modeleMowy: { small: null } });
  });

  it('niezgodna suma SHA-256: plik usuniety, blad, brak czesciowej instalacji', async () => {
    const otworz = jest.fn(async () => Readable.from([glos]));
    await expect(zainstaluj('pl_PL-gosia-medium', undefined, home, { otworz, katalog: katalogGlosu('0'.repeat(64)) }))
      .rejects.toThrow('Niezgodna suma SHA-256');
    expect(bin()).toEqual([]);
    expect(stan(home)).toMatchObject({ glosy: { 'pl_PL-gosia-medium': null } });
  });

  it('przerwane pobranie: .part sprzatniety, kolejna proba od zera konczy sie instalacja', async () => {
    const zerwane = async (): Promise<Readable> => new Readable({
      read() { this.push(glos.subarray(0, 5)); this.destroy(new Error('ECONNRESET')); },
    });
    const katalog = katalogGlosu(sha(glos));
    await expect(zainstaluj('pl_PL-gosia-medium', undefined, home, { otworz: zerwane, katalog }))
      .rejects.toThrow('przerwane: ECONNRESET');
    expect(bin()).toEqual([]);

    const postep = jest.fn();
    const exe = await zainstaluj('pl_PL-gosia-medium', postep, home, { otworz: async () => Readable.from([glos]), katalog });
    expect(fs.readFileSync(exe)).toEqual(glos);
    expect(postep).toHaveBeenLastCalledWith(glos.length, glos.length);
    expect(bin()).toEqual(['glosy']);
  });

  // Systemowy tar.exe jest tylko na Windows; CI na Linuksie ten przypadek pomija.
  (naWindows ? describe : describe.skip)('z prawdziwym tar.exe', () => it('instalacja z zipa: stan() zwraca sciezke exe', async () => {
    const zrodla = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-zip-'));
    try {
      fs.mkdirSync(path.join(zrodla, 'piper'));
      fs.writeFileSync(path.join(zrodla, 'piper', 'piper.exe'), 'atrapa');
      const zip = path.join(zrodla, 'paczka.zip');
      const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
      childProcess.execFileSync(tar, ['-a', '-cf', zip, '-C', zrodla, 'piper']);
      const dane = fs.readFileSync(zip);
      (childProcess.spawn as jest.Mock).mockImplementation(jest.requireActual('child_process').spawn);
      const katalog = { piper: { cel: 'piper', sprawdz: 'piper.exe', rozpakuj: { korzen: 'piper' },
        pliki: [{ nazwa: 'paczka.zip', url: 'https://x/zip', rozmiar: dane.length, sha256: sha(dane) }] } };

      await zainstaluj('piper', undefined, home, { otworz: async () => Readable.from([dane]), katalog });
      const s = stan(home);
      expect(s).toMatchObject({ piper: path.join(katalogNarzedzi(home), 'piper', 'piper.exe'), ffmpeg: null });
      expect(bin()).toEqual(['piper']);
    } finally {
      fs.rmSync(zrodla, { recursive: true, force: true });
    }
  }));

  it('syntezuj bez Pipera: czytelny blad, zaden proces nie startuje', async () => {
    await expect(syntezuj('Czesc', 'pl_PL-gosia-medium', home)).rejects.toThrow('Piper niezainstalowany');
    await expect(syntezuj('Czesc', '../../zly', home)).rejects.toThrow('Nieznany glos');
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('inna platforma: nieobslugiwane, zero zapytan sieciowych', async () => {
    ustawPlatforme('linux', 'x64');
    const otworz = jest.fn();
    expect(stan(home)).toEqual({ obslugiwane: false });
    await expect(zainstaluj('piper', undefined, home, { otworz })).rejects.toThrow('tylko na Windows x64');
    await expect(syntezuj('Czesc', 'pl_PL-gosia-medium', home)).rejects.toThrow('tylko na Windows x64');
    expect(otworz).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});
