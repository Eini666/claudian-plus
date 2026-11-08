/**
 * Przypiete pliki narzedzi glosu (D5): instalator pobiera wylacznie te adresy i przyjmuje plik
 * tylko przy zgodnym rozmiarze i SHA-256. Nowa wersja = nowy wpis z sumami policzonymi z pobrania.
 *
 * Licencje (do README):
 * - Piper 2023.11.14-2 (rhasspy/piper, repo archiwalne) — MIT; w paczce espeak-ng (GPL-3.0).
 * - Glosy gosia, darkman, mc_speech (rhasspy/piper-voices, MODEL_CARD) — zbiory danych CC0,
 *   modele dostrojone z angielskiego glosu lessac (medium).
 * - ffmpeg 9.0.2 essentials (gyan.dev, GyanD/codexffmpeg) — build GPL-3.0, zawiera libopus.
 * - whisper.cpp v1.9.2 (ggml-org/whisper.cpp, build CPU Windows x64) — MIT.
 * - Modele ggml Whisper (ggerganov/whisper.cpp na HF; wagi OpenAI Whisper) — MIT.
 */

export interface PlikNarzedzia {
  nazwa: string;
  url: string;
  rozmiar: number;
  sha256: string;
}

export interface Narzedzie {
  /** Podkatalog w `~/.claudian-plus/bin`. */
  cel: string;
  pliki: PlikNarzedzia[];
  /** Zip: `korzen` w archiwum staje sie `bin/<cel>`; `czlonek` zaweza rozpakowanie do jednego pliku. */
  rozpakuj?: { korzen: string; czlonek?: string };
  /** Plik, ktorego obecnosc znaczy „zainstalowane” (wzgledem `bin/<cel>`). */
  sprawdz: string;
}

export const GLOSY = ['pl_PL-gosia-medium', 'pl_PL-darkman-medium', 'pl_PL-mc_speech-medium'] as const;
export type NazwaGlosu = (typeof GLOSY)[number];
export const MODELE_MOWY = ['large-v3-turbo', 'small'] as const;
export type NazwaModeluMowy = (typeof MODELE_MOWY)[number];
export type CoInstalowac = 'piper' | 'ffmpeg' | 'whisper' | NazwaGlosu | NazwaModeluMowy;

// Commit repo piper-voices z 08.11.2026 — `main` moze sie zmienic, commit nie.
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/e7229f7d33a10e145e109b886d661984201ac3c4/pl/pl_PL';

const glos = (mowca: string, onnx: string, json: string, rozmiarJson: number): Narzedzie => {
  const nazwa = `pl_PL-${mowca}-medium`;
  return {
    cel: `glosy/${nazwa}`,
    sprawdz: `${nazwa}.onnx`,
    pliki: [
      { nazwa: `${nazwa}.onnx`, url: `${HF}/${mowca}/medium/${nazwa}.onnx`, rozmiar: 63201294, sha256: onnx },
      { nazwa: `${nazwa}.onnx.json`, url: `${HF}/${mowca}/medium/${nazwa}.onnx.json`, rozmiar: rozmiarJson, sha256: json },
    ],
  };
};

// Commit repo ggerganov/whisper.cpp z 08.11.2026.
const HF_WHISPER = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';

/** Kazdy model we wlasnym katalogu: instalacja podmienia caly `cel`, wspolny skasowalby drugi model. */
const modelMowy = (nazwa: NazwaModeluMowy, plik: string, rozmiar: number, sha256: string): Narzedzie => ({
  cel: `modele-mowy/${nazwa}`,
  sprawdz: plik,
  pliki: [{ nazwa: plik, url: `${HF_WHISPER}/${plik}`, rozmiar, sha256 }],
});

export const KATALOG: Record<CoInstalowac, Narzedzie> = {
  piper: {
    cel: 'piper',
    sprawdz: 'piper.exe',
    rozpakuj: { korzen: 'piper' },
    pliki: [{
      nazwa: 'piper_windows_amd64.zip',
      url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
      rozmiar: 22477236,
      sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
    }],
  },
  ffmpeg: {
    cel: 'ffmpeg',
    sprawdz: 'ffmpeg.exe',
    rozpakuj: {
      korzen: 'ffmpeg-9.0.2-essentials_build/bin',
      czlonek: 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe',
    },
    pliki: [{
      nazwa: 'ffmpeg-9.0.2-essentials_build.zip',
      url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
      rozmiar: 114768076,
      sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    }],
  },
  whisper: {
    cel: 'whisper',
    sprawdz: 'whisper-cli.exe',
    rozpakuj: { korzen: 'Release' },
    pliki: [{
      nazwa: 'whisper-bin-x64.zip',
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip',
      rozmiar: 8194445,
      sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
    }],
  },
  'large-v3-turbo': modelMowy('large-v3-turbo', 'ggml-large-v3-turbo-q5_0.bin', 574041195,
    '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'),
  small: modelMowy('small', 'ggml-small-q5_1.bin', 190085487,
    'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb'),
  'pl_PL-gosia-medium': glos('gosia',
    '38f66464240ed74f186e6b7dc13c6e3b22e023426299f25c2b3cc9dfa9373fbc',
    '1aefb31a9d53ffe44a8163ff73ec833acb7a6253848f6bb0403d8a66f9c7510d', 4814),
  'pl_PL-darkman-medium': glos('darkman',
    'db505438a5364e8e2e0242c4324130a873ed660dfbe8d9689cef428ffb1b645f',
    '70f999f11fa8ad13d3ef779041ee93c9f38be5abdbacdfad42449712fe91c81b', 4816),
  'pl_PL-mc_speech-medium': glos('mc_speech',
    'a6b043358bc81e6c111a5140606a21959ce7f34969b8b7207f62869787cc3907',
    'b8bb11228e15c505219846a88fdc129e93f57e774ed7f9bac263156d1aa3d324', 4961),
};
