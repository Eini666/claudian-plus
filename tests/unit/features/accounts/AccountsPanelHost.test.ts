import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AccountsPanelHost, type UstawieniaPanelu } from '@/features/accounts/AccountsPanelHost';
import { katalogPanelu, zapiszPlikiPanelu } from '@/features/accounts/panelFiles';
import type { PanelHealth } from '@/utils/accountsPanel';

type Health = PanelHealth | 'obcy' | null;

const PLIKI = { mjs: 'const PANEL_VERSION = 2\n', html: '<html></html>' };
const NASZ: PanelHealth = { app: 'claudian-plus-accounts', version: 2 };
const STARY: PanelHealth = { app: 'claudian-plus-accounts', version: 1 };

class FakeChild extends EventEmitter {
  kill = jest.fn(() => true);
}

interface Opcje {
  health: Health[];
  /** Co `spawn` ma zrobic: wystartowac, zglosic ENOENT albo od razu paść z linia w logu. */
  spawnTryb?: 'ok' | 'enoent' | 'pada';
}

describe('AccountsPanelHost', () => {
  let home: string;
  let ustawienia: UstawieniaPanelu;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'plus-host-'));
    ustawienia = { accountSwitcherEnabled: true, accountsPanelManaged: true, accountsPanelUrl: 'http://127.0.0.1:7788' };
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** `health` oddaje kolejne wartosci z listy; po spawnie (tryb ok) odpowiada nasz panel. */
  function zbuduj({ health, spawnTryb = 'ok' }: Opcje) {
    const kolejka = [...health];
    let wystartowal = false;
    const dzieci: FakeChild[] = [];
    const healthFn = jest.fn(async (): Promise<Health> => {
      if (wystartowal) return NASZ;
      return kolejka.length > 1 ? kolejka.shift()! : kolejka[0];
    });
    const stopFn = jest.fn(async () => true);
    const spawn = jest.fn((_cmd: string, _args: string[], opts: { stdio: [unknown, number, number] }) => {
      const child = new FakeChild();
      dzieci.push(child);
      if (spawnTryb === 'pada') fs.writeSync(opts.stdio[1], 'start\nError: listen EADDRINUSE 7788\n\n');
      process.nextTick(() => {
        if (spawnTryb === 'enoent') {
          child.emit('error', Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }));
          return;
        }
        child.emit('spawn');
        if (spawnTryb === 'ok') wystartowal = true;
        else child.emit('exit', 1);
      });
      return child;
    });
    const host = new AccountsPanelHost(() => ustawienia, {
      home,
      pliki: PLIKI,
      health: healthFn,
      stopPanel: stopFn,
      spawn: spawn as never,
      krokMs: 1,
    });
    return { host, healthFn, stopFn, spawn, dzieci };
  }

  it('nasz panel w biezacej wersji: przejmuje bez spawnu', async () => {
    const { host, spawn } = zbuduj({ health: [NASZ] });
    // pierwszy zapis plikow to „zmienione” — kladziemy je wczesniej, jak po poprzednim starcie
    zapiszPlikiPanelu(home, PLIKI);
    await host.odswiez();
    expect(spawn).not.toHaveBeenCalled();
    expect(host.stan.stan).toBe('nasz');
  });

  it('nasz w starej wersji: shutdown, czekanie na cisze, potem spawn', async () => {
    const { host, stopFn, spawn } = zbuduj({ health: [STARY, STARY, null] });
    await host.odswiez();
    expect(stopFn).toHaveBeenCalledWith('http://127.0.0.1:7788');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(stopFn.mock.invocationCallOrder[0]).toBeLessThan(spawn.mock.invocationCallOrder[0]);
    expect(host.stan.stan).toBe('nasz');
  });

  it('cudzy panel: bez spawnu, a stop() nie wola shutdown', async () => {
    const { host, stopFn, spawn } = zbuduj({ health: ['obcy'] });
    await host.odswiez();
    expect(host.stan.stan).toBe('obcy');
    host.stop();
    expect(spawn).not.toHaveBeenCalled();
    expect(stopFn).not.toHaveBeenCalled();
  });

  it('cisza: spawn node z accounts.mjs serve 7788 w katalogu panelu', async () => {
    const { host, spawn, dzieci } = zbuduj({ health: [null] });
    await host.odswiez();
    const katalog = katalogPanelu(home);
    expect(spawn).toHaveBeenCalledWith(
      'node',
      [path.join(katalog, 'accounts.mjs'), 'serve', '7788'],
      expect.objectContaining({ cwd: katalog, windowsHide: true }),
    );
    expect(host.stan.stan).toBe('nasz');
    host.stop();
    expect(dzieci[0].kill).toHaveBeenCalled();
  });

  it('port z adresu trafia do argumentow', async () => {
    ustawienia.accountsPanelUrl = 'http://localhost:7799/';
    const { host, spawn } = zbuduj({ health: [null] });
    await host.odswiez();
    expect(spawn.mock.calls[0][1][2]).toBe('7799');
  });

  it('adres nielokalny: bez spawnu i bez sondy', async () => {
    ustawienia.accountsPanelUrl = 'http://192.168.1.5:7788';
    const { host, spawn, healthFn } = zbuduj({ health: [null] });
    await host.odswiez();
    expect(host.stan.stan).toBe('nielokalny');
    expect(spawn).not.toHaveBeenCalled();
    expect(healthFn).not.toHaveBeenCalled();
  });

  it.each([
    ['przelacznik', 'accountSwitcherEnabled'],
    ['zarzadzanie', 'accountsPanelManaged'],
  ] as const)('wylaczone %s: bez spawnu, a nasz panel zostaje zatrzymany', async (_n, klucz) => {
    const { host, spawn, dzieci } = zbuduj({ health: [null] });
    await host.odswiez();
    expect(spawn).toHaveBeenCalledTimes(1);

    ustawienia[klucz] = false;
    await host.odswiez();
    expect(dzieci[0].kill).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(host.stan.stan).toBe('wylaczony');
  });

  it('brak node w PATH: stan brak-node', async () => {
    const { host } = zbuduj({ health: [null], spawnTryb: 'enoent' });
    await host.odswiez();
    expect(host.stan.stan).toBe('brak-node');
  });

  it('serwer konczy sie sam: blad z ostatnia niepusta linia logu', async () => {
    const { host } = zbuduj({ health: [null], spawnTryb: 'pada' });
    await host.odswiez();
    expect(host.stan).toEqual({ stan: 'blad', powod: 'Error: listen EADDRINUSE 7788' });
  });

  it('dwa rownolegle odswiez() daja jeden spawn', async () => {
    const { host, spawn } = zbuduj({ health: [null] });
    await Promise.all([host.odswiez(), host.odswiez()]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(host.stan.stan).toBe('nasz');
  });

  it('zmiana stanu trafia do sluchacza', async () => {
    const { host } = zbuduj({ health: ['obcy'] });
    const cb = jest.fn();
    host.naZmiane(cb);
    await host.odswiez();
    expect(cb).toHaveBeenCalledWith('obcy', '');
  });
});
