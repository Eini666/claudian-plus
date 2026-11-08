/**
 * Glosowka z Telegrama (OGG/Opus) -> tekst: ffmpeg (WAV 16 kHz mono) -> whisper.cpp (`-l pl`).
 * Lokalnie, bez Pythona i CUDA; narzedzia z `~/.claudian-plus/bin` (voiceCatalog).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MODELE_MOWY, type NazwaModeluMowy } from './voiceCatalog';
import { stan, uruchom } from './voiceTools';

export async function transkrybuj(bajty: Buffer, model: string, home?: string): Promise<string> {
  const s = stan(home);
  if (!s.obslugiwane) throw new Error('Narzedzia glosu sa obslugiwane tylko na Windows x64');
  if (!bajty.length) throw new Error('Pusta glosowka');
  if (!(MODELE_MOWY as readonly string[]).includes(model)) throw new Error(`Nieznany model mowy: ${model}`);
  if (!s.whisper) throw new Error('Rozpoznawanie mowy niezainstalowane');
  if (!s.ffmpeg) throw new Error('ffmpeg niezainstalowany');
  const plikModelu = s.modeleMowy[model as NazwaModeluMowy];
  if (!plikModelu) throw new Error(`Model mowy ${model} niezainstalowany`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-plus-stt-'));
  try {
    const ogg = path.join(tmp, 'glosowka.ogg');
    const wav = path.join(tmp, 'glosowka.wav');
    const wynik = path.join(tmp, 'wynik');
    fs.writeFileSync(ogg, bajty);
    await uruchom(s.ffmpeg, ['-y', '-loglevel', 'error', '-i', ogg, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    // Domyslnie whisper-cli bierze 4 watki; wszystkie logiczne skracaja large-v3-turbo prawie o polowe (pomiar 08.11).
    const watki = String(Math.max(1, os.cpus().length));
    await uruchom(s.whisper, ['-m', plikModelu, '-l', 'pl', '-t', watki, '-f', wav, '-nt', '-otxt', '-of', wynik]);
    return fs.readFileSync(`${wynik}.txt`, 'utf8').replace(/\s+/g, ' ').trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
