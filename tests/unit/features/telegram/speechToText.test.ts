import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { katalogNarzedzi } from '@/features/telegram/plusHome';
import { transkrybuj } from '@/features/telegram/speechToText';

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn() }));
jest.mock('os', () => ({ ...jest.requireActual('os'), tmpdir: jest.fn() }));

const spawn = childProcess.spawn as jest.Mock;
const prawdziwyTmp = (jest.requireActual('os') as typeof os).tmpdir();

/** Atrapa procesu: konczy sie kodem `kod`; przed tym `przed(args)` moze zapisac pliki wyjsciowe. */
function atrapa(kod: number, przed: (args: string[]) => void = () => {}) {
  return (_exe: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      stdin: { on: () => {}, end: () => {} },
      kill: jest.fn(),
    });
    setImmediate(() => {
      przed(args);
      if (kod !== 0) child.stderr.emit('data', Buffer.from('blad atrapy'));
      child.emit('close', kod, null);
    });
    return child;
  };
}

describe('transkrybuj', () => {
  const prawdziwa = { platform: process.platform, arch: process.arch };
  let home: string;
  let tmp: string;

  const ustawPlatforme = (platform: string, arch: string): void => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
  };
  const polozAtrape = (wzgledna: string): void => {
    const plik = path.join(katalogNarzedzi(home), wzgledna);
    fs.mkdirSync(path.dirname(plik), { recursive: true });
    fs.writeFileSync(plik, 'atrapa');
  };
  const zainstalujWszystko = (): void => {
    polozAtrape('whisper/whisper-cli.exe');
    polozAtrape('ffmpeg/ffmpeg.exe');
    polozAtrape('modele-mowy/small/ggml-small-q5_1.bin');
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(prawdziwyTmp, 'plus-stt-home-'));
    tmp = fs.mkdtempSync(path.join(prawdziwyTmp, 'plus-stt-tmp-'));
    (os.tmpdir as jest.Mock).mockReturnValue(tmp);
    ustawPlatforme('win32', 'x64');
    spawn.mockReset();
  });

  afterEach(() => {
    ustawPlatforme(prawdziwa.platform, prawdziwa.arch);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('bez whispera: czytelny blad, zaden proces nie startuje', async () => {
    await expect(transkrybuj(Buffer.from('ogg'), 'small', home)).rejects.toThrow('Rozpoznawanie mowy niezainstalowane');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('bez modelu albo z nieznanym modelem: blad o modelu, zaden proces', async () => {
    polozAtrape('whisper/whisper-cli.exe');
    polozAtrape('ffmpeg/ffmpeg.exe');
    await expect(transkrybuj(Buffer.from('ogg'), 'small', home)).rejects.toThrow('Model mowy small niezainstalowany');
    await expect(transkrybuj(Buffer.from('ogg'), '../../zly', home)).rejects.toThrow('Nieznany model mowy');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('blad procesu: pliki tymczasowe usuniete', async () => {
    zainstalujWszystko();
    spawn.mockImplementation(atrapa(1));
    await expect(transkrybuj(Buffer.from('ogg'), 'small', home)).rejects.toThrow('ffmpeg.exe zakonczyl sie bledem (1): blad atrapy');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('sukces: tekst z whispera przyciety, argumenty bez powloki, tmp sprzatniety', async () => {
    zainstalujWszystko();
    spawn.mockImplementation(atrapa(0, (args) => {
      const of = args.indexOf('-of');
      if (of >= 0) fs.writeFileSync(`${args[of + 1]}.txt`, '  Ari, sprawdz testy.\n', 'utf8');
    }));
    await expect(transkrybuj(Buffer.from('ogg'), 'small', home)).resolves.toBe('Ari, sprawdz testy.');
    const [whisperExe, whisperArgs] = spawn.mock.calls[1] as [string, string[]];
    expect(whisperExe).toBe(path.join(katalogNarzedzi(home), 'whisper', 'whisper-cli.exe'));
    expect(whisperArgs).toEqual(expect.arrayContaining(['-l', 'pl', '-nt', '-otxt']));
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});
