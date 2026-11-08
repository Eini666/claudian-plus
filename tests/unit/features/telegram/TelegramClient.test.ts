import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { czytajSekrety, plikBlokadyMostu, zapiszSekrety } from '@/features/telegram/plusHome';
import {
  type ObslugaTelegrama,
  podziel,
  TEKST_BEZ_TRANSKRYPCJI,
  TEKST_BLAD_GLOSOWKI,
  TEKST_PO_PAROWANIU,
  TelegramClient,
} from '@/features/telegram/TelegramClient';

const TOKEN = '123456:SEKRET-testowy-token';
const MOJ = 111;

const json = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
const wiad = (chatId: number, dane: Record<string, unknown>, updateId = 1) =>
  ({ update_id: updateId, message: { chat: { id: chatId, type: 'private' }, date: 1_700_000_000, ...dane } });

/** Atrapa api.telegram.org: getUpdates wisi, dopoki test nie dostarczy paczki albo nie przyjdzie abort. */
function atrapa() {
  const wywolania: Array<{ metoda: string; body: any }> = [];
  const kolejka: Array<unknown[] | Error> = [];
  let czeka: ((v: unknown[] | Error) => void) | null = null;
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/file/bot')) return new Response(Buffer.from('OGG'));
    const metoda = url.split('/').pop() as string;
    const body = init?.body instanceof FormData
      ? init.body
      : Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams));
    wywolania.push({ metoda, body });
    if (metoda === 'getFile') return json({ file_path: 'voice/1.oga' });
    if (metoda !== 'getUpdates') return json(true);
    const nast = kolejka.shift() ?? await new Promise<unknown[] | Error>((resolve, reject) => {
      czeka = resolve;
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    if (nast instanceof Error) throw nast;
    return json(nast);
  });
  const dostarcz = (v: unknown[] | Error) => {
    if (czeka) { const c = czeka; czeka = null; c(v); } else kolejka.push(v);
  };
  const ile = (metoda: string) => wywolania.filter((w) => w.metoda === metoda);
  return { fetch: fetchMock as unknown as typeof fetch, fetchMock, wywolania, dostarcz, ile };
}

async function czekajNa(warunek: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (warunek()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('warunek nie spelnil sie');
}

describe('TelegramClient', () => {
  let home: string;
  let api: ReturnType<typeof atrapa>;
  let log: jest.Mock;
  let klienci: TelegramClient[];
  const nowy = () => {
    // Pobranie pliku idzie w produkcji przez Node https (CORS); w testach przez te sama atrape.
    const pobierz = async (url: string) => Buffer.from(await (await api.fetch(url)).arrayBuffer());
    const k = new TelegramClient({ home, fetch: api.fetch, pobierz, log });
    klienci.push(k);
    return k;
  };
  const obsluga = (extra: Partial<ObslugaTelegrama> = {}) =>
    ({ obsluz: jest.fn(async (t: string) => `echo: ${t}`), ...extra });

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-tg-'));
    zapiszSekrety({ token: TOKEN, chatId: MOJ }, home);
    api = atrapa();
    log = jest.fn();
    klienci = [];
  });

  afterEach(() => {
    klienci.forEach((k) => k.stop());
    jest.useRealTimers();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('obcy chat_id: brak przekazania i brak odpowiedzi; wlasny dostaje odpowiedz', async () => {
    const o = obsluga();
    api.dostarcz([wiad(999, { text: 'daj notatki' }, 1), wiad(MOJ, { text: 'hej' }, 2)]);
    expect(nowy().start(o)).toBe('dziala');
    await czekajNa(() => api.ile('getUpdates').length === 2);

    expect(o.obsluz).toHaveBeenCalledTimes(1);
    expect(o.obsluz).toHaveBeenCalledWith('hej', expect.objectContaining({ zGlosu: false }));
    expect(api.ile('sendMessage').map((w) => w.body)).toEqual([{ chat_id: String(MOJ), text: 'echo: hej' }]);
    expect(api.ile('getUpdates')[1].body.offset).toBe('3');
  });

  it('parowanie: pierwsza wiadomosc zapisuje chat id i wysyla „Połączono…”', async () => {
    zapiszSekrety({ token: TOKEN, chatId: null }, home);
    const o = obsluga();
    api.dostarcz([wiad(555, { text: '/start' })]);
    const k = nowy();
    k.start(o);

    await expect(k.rozpocznijParowanie()).resolves.toBe('sparowano');
    expect(czytajSekrety(home)).toEqual({ token: TOKEN, chatId: 555 });
    expect(api.ile('sendMessage').map((w) => w.body)).toEqual([{ chat_id: '555', text: TEKST_PO_PAROWANIU }]);
    expect(o.obsluz).not.toHaveBeenCalled();
  });

  it('parowanie: po uplywie okna nieaktywne, wiadomosc z nowego czatu ignorowana', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    zapiszSekrety({ token: TOKEN, chatId: null }, home);
    const o = obsluga();
    const k = nowy();
    k.start(o);
    const wynik = k.rozpocznijParowanie(120);
    await jest.advanceTimersByTimeAsync(120_000);
    await expect(wynik).resolves.toBe('czas-minal');

    api.dostarcz([wiad(555, { text: '/start' })]);
    await czekajNa(() => api.ile('getUpdates').length === 2);
    expect(czytajSekrety(home)?.chatId).toBeNull();
    expect(api.ile('sendMessage')).toHaveLength(0);
    expect(o.obsluz).not.toHaveBeenCalled();
  });

  it('parowanie bez dzialajacego nasluchu: odrzucone', async () => {
    await expect(nowy().rozpocznijParowanie()).rejects.toThrow('nie działa');
  });

  it('tekst 9000 znakow: 3 x sendMessage, ciecie na granicy zdania', async () => {
    const zdanie = 'Zdanie numer kolejne i calkiem dlugie. ';
    const tekst = zdanie.repeat(Math.ceil(9000 / zdanie.length)).slice(0, 9000);
    await nowy().wyslijTekst(tekst);

    const wyslane = api.ile('sendMessage').map((w) => w.body.text as string);
    expect(wyslane).toHaveLength(3);
    expect(wyslane.every((t) => t.length <= 4000)).toBe(true);
    expect(wyslane[0].endsWith('.')).toBe(true);
    expect(wyslane[1].endsWith('.')).toBe(true);
    expect(podziel('a'.repeat(9000)).every((t) => t.length <= 4000)).toBe(true);
  });

  it('wyslijGlos: podpis 1500 znakow pominiety, krotki dolaczony', async () => {
    const ogg = path.join(home, 'g.ogg');
    fs.writeFileSync(ogg, 'OggS');
    const k = nowy();
    await k.wyslijGlos(ogg, 'x'.repeat(1500));
    await k.wyslijGlos(ogg, 'krotki podpis');

    const [dlugi, krotki] = api.ile('sendVoice').map((w) => w.body as FormData);
    expect(dlugi.get('caption')).toBeNull();
    expect(dlugi.get('chat_id')).toBe(String(MOJ));
    expect(dlugi.get('voice')).toBeInstanceOf(Blob);
    expect(krotki.get('caption')).toBe('krotki podpis');
  });

  it('blad sieci: ponowienie po odstepie, komunikat bez tokenu', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const o = obsluga();
    api.dostarcz(new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getUpdates`));
    api.dostarcz([wiad(MOJ, { text: 'po awarii' })]);
    nowy().start(o);

    await czekajNa(() => log.mock.calls.length === 1);
    expect(api.ile('getUpdates')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1000);
    await czekajNa(() => api.ile('getUpdates').length === 3);

    expect(o.obsluz).toHaveBeenCalledWith('po awarii', expect.anything());
    const logi = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logi).toContain('brak połączenia');
    expect(logi).not.toContain(TOKEN);
    expect(logi).not.toContain('SEKRET');
  });

  it('blokada: drugi klient przy zywej blokadzie nie odpytuje; stop zwalnia', () => {
    const a = nowy();
    expect(a.start(obsluga())).toBe('dziala');
    const poA = api.fetchMock.mock.calls.length;

    expect(nowy().start(obsluga())).toBe('zajete');
    expect(api.fetchMock.mock.calls.length).toBe(poA);

    a.stop();
    expect(fs.existsSync(plikBlokadyMostu(home))).toBe(false);
  });

  it('blokada: przeterminowana zostaje przejeta', () => {
    fs.writeFileSync(plikBlokadyMostu(home), JSON.stringify({ pid: 1, wlasciciel: 'inne-okno', ts: Date.now() - 100_000 }));
    expect(nowy().start(obsluga())).toBe('dziala');
    expect(JSON.parse(fs.readFileSync(plikBlokadyMostu(home), 'utf8')).wlasciciel).not.toBe('inne-okno');
    expect(api.ile('getUpdates')).toHaveLength(1);
  });

  it('brak tokenu: start nie odpytuje', () => {
    fs.rmSync(path.join(home, '.claudian-plus'), { recursive: true });
    expect(nowy().start(obsluga())).toBe('brak-tokenu');
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('glosowka bez transkrybuj: uprzejma odpowiedz, obsluz nie wolane', async () => {
    const o = obsluga();
    api.dostarcz([wiad(MOJ, { voice: { file_id: 'f1', duration: 3 } })]);
    nowy().start(o);
    await czekajNa(() => api.ile('getUpdates').length === 2);

    expect(o.obsluz).not.toHaveBeenCalled();
    expect(api.ile('sendMessage').map((w) => w.body.text)).toEqual([TEKST_BEZ_TRANSKRYPCJI]);
    expect(api.ile('getFile')).toHaveLength(0);
  });

  it('CORS: zadne zapytanie nie wymaga preflightu (bez naglowkow, body urlencoded/multipart)', async () => {
    const ogg = path.join(home, 'g.ogg');
    fs.writeFileSync(ogg, 'OggS');
    api.dostarcz([wiad(MOJ, { voice: { file_id: 'f1' } }), wiad(MOJ, { text: 'hej' }, 2)]);
    nowy().start(obsluga({ transkrybuj: async () => 'tekst' }));
    await czekajNa(() => api.ile('getUpdates').length === 2);
    const k = nowy();
    await k.wyslijGlos(ogg, 'podpis');

    const wywolania = api.fetchMock.mock.calls;
    expect(wywolania.map(([url]) => url.split('/').pop())).toEqual(
      expect.arrayContaining(['getUpdates', 'getFile', '1.oga', 'sendMessage', 'sendVoice']),
    );
    for (const [, init] of wywolania) {
      expect(init?.headers).toBeUndefined();
      expect(['GET', 'POST']).toContain(init?.method ?? 'GET');
    }
    const pobrania = wywolania.filter(([url]) => url.includes('/file/bot'));
    const api_ = wywolania.filter(([url]) => !url.includes('/file/bot'));
    expect(pobrania.map(([, init]) => init?.body)).toEqual([undefined]);
    expect(api_.every(([, init]) => init?.body instanceof URLSearchParams || init?.body instanceof FormData)).toBe(true);
    expect(api.ile('getUpdates')[0].body.timeout).toBe('50');
  });

  it('glosowka z transkrybuj: tekst trafia do obsluz', async () => {
    const transkrybuj = jest.fn(async (b: Buffer) => (b.toString() === 'OGG' ? ' kup mleko ' : null));
    const o = obsluga({ transkrybuj });
    api.dostarcz([wiad(MOJ, { voice: { file_id: 'f1', duration: 3 } })]);
    nowy().start(o);
    await czekajNa(() => api.ile('getUpdates').length === 2);

    expect(api.ile('getFile')[0].body).toEqual({ file_id: 'f1' });
    expect(o.obsluz).toHaveBeenCalledWith('kup mleko', expect.objectContaining({ zGlosu: true }));
    expect(api.ile('sendMessage').map((w) => w.body.text)).toEqual(['echo: kup mleko']);
  });

  it('blad pobrania albo transkrypcji glosowki: uzytkownik dostaje komunikat zamiast ciszy', async () => {
    const o = obsluga({ transkrybuj: async () => { throw new Error('whisper padl'); } });
    api.dostarcz([wiad(MOJ, { voice: { file_id: 'f1' } })]);
    nowy().start(o);
    await czekajNa(() => api.ile('sendMessage').length === 1);

    expect(o.obsluz).not.toHaveBeenCalled();
    expect(api.ile('sendMessage')[0].body.text).toBe(TEKST_BLAD_GLOSOWKI);
    expect(log.mock.calls.flat().join(' ')).toContain('whisper padl');
  });

  it('glosowka z pusta transkrypcja: obsluz dostaje pusty tekst (router odpowiada)', async () => {
    const o = obsluga({ transkrybuj: async () => null });
    api.dostarcz([wiad(MOJ, { voice: { file_id: 'f1' } })]);
    nowy().start(o);
    await czekajNa(() => api.ile('getUpdates').length === 2);

    expect(o.obsluz).toHaveBeenCalledWith('', expect.objectContaining({ zGlosu: true }));
  });
});
