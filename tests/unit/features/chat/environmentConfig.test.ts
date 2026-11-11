import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  type EnvironmentState,
  readEnvironmentState,
  setMcpServerEnabled,
  setOutputStyle,
  setPluginEnabled,
} from '@/features/chat/environment/environmentConfig';

/**
 * Konfiguracja-atrapa w katalogu tymczasowym. `CLAUDE_CONFIG_DIR` przekierowuje
 * `resolveClaudeConfigDir`, a `.claude.json` leży PIĘTRO WYŻEJ — dokładnie jak
 * u użytkownika (`~/.claude/` obok `~/.claude.json`).
 */
async function makeHome(): Promise<{ home: string; configDir: string; vault: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-env-'));
  const configDir = path.join(home, '.claude');
  const vault = path.join(home, 'vault');
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(path.join(vault, '.claude'), { recursive: true });

  await fs.writeFile(
    path.join(configDir, 'settings.json'),
    JSON.stringify({
      enabledPlugins: { 'caveman@local': true, 'ponytail@ponytail': true },
      outputStyle: 'adhd',
      model: 'opus',
    }),
    'utf-8',
  );
  await fs.writeFile(
    path.join(home, '.claude.json'),
    JSON.stringify({
      numStartups: 7,
      mcpServers: { pencil: { command: 'pencil.exe' }, mysql: { command: 'mysql.exe' } },
    }),
    'utf-8',
  );
  await fs.writeFile(
    path.join(vault, '.mcp.json'),
    JSON.stringify({ mcpServers: { supabase: { type: 'http', url: 'https://example.test' } } }),
    'utf-8',
  );

  process.env.CLAUDE_CONFIG_DIR = configDir;
  return { home, configDir, vault };
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
}

describe('environmentConfig', () => {
  let home: string;
  let configDir: string;
  let vault: string;
  let state: EnvironmentState;

  beforeEach(async () => {
    ({ home, configDir, vault } = await makeHome());
    state = await readEnvironmentState(vault);
  });

  afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    await fs.rm(home, { force: true, recursive: true });
  });

  it('czyta wtyczki, serwery MCP i styl odpowiedzi', () => {
    expect(state.outputStyle).toBe('adhd');
    expect(state.plugins.map(p => p.label)).toEqual(['caveman', 'ponytail']);
    expect(state.mcpServers.map(s => s.id)).toEqual(['mysql', 'pencil', 'supabase']);
    expect(state.mcpServers.every(s => s.enabled)).toBe(true);
  });

  it('wyłączenie wtyczki zapisuje false, reszta ustawień zostaje', async () => {
    await setPluginEnabled(configDir, 'caveman@local', false);

    const saved = await readJson(path.join(configDir, 'settings.json'));
    expect((saved.enabledPlugins as Record<string, unknown>)['caveman@local']).toBe(false);
    expect((saved.enabledPlugins as Record<string, unknown>)['ponytail@ponytail']).toBe(true);
    expect(saved.model).toBe('opus');
  });

  it('uszkodzony settings.json: zapis przerwany, plik nietknięty', async () => {
    const file = path.join(configDir, 'settings.json');
    const broken = '{"hooks": {"Stop": [], ';
    await fs.writeFile(file, broken);

    await expect(setPluginEnabled(configDir, 'caveman@local', false)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf-8')).toBe(broken);
  });

  it('uszkodzony .claude.json: przełącznik MCP niczego nie zapisuje', async () => {
    const file = path.join(home, '.claude.json');
    await fs.writeFile(file, 'nie-json');
    const pencil = state.mcpServers.find(s => s.id === 'pencil')!;

    await expect(setMcpServerEnabled(state, pencil, false)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf-8')).toBe('nie-json');
  });

  it('brak settings.json: zapis tworzy plik', async () => {
    await fs.rm(path.join(configDir, 'settings.json'));
    await setPluginEnabled(configDir, 'caveman@local', false);

    const saved = await readJson(path.join(configDir, 'settings.json'));
    expect(saved.enabledPlugins).toEqual({ 'caveman@local': false });
  });

  it('przed pierwszym zapisem zostaje kopia .bak', async () => {
    const file = path.join(configDir, 'settings.json');
    const before = await fs.readFile(file, 'utf-8');
    await setPluginEnabled(configDir, 'caveman@local', false);

    expect(await fs.readFile(`${file}.claudian-bak`, 'utf-8')).toBe(before);
  });

  it('wyłączony serwer użytkownika ląduje na parkingu z całą definicją i wraca', async () => {
    const pencil = state.mcpServers.find(s => s.id === 'pencil')!;
    await setMcpServerEnabled(state, pencil, false);

    let saved = await readJson(path.join(home, '.claude.json'));
    expect(Object.keys(saved.mcpServers as object)).toEqual(['mysql']);
    expect((saved.mcpServersDisabled as Record<string, { command: string }>).pencil.command)
      .toBe('pencil.exe');
    // Nieznane pola CLI muszą przeżyć zapis — inaczej panel kasuje cudzy stan.
    expect(saved.numStartups).toBe(7);

    const afterOff = await readEnvironmentState(vault);
    expect(afterOff.mcpServers.find(s => s.id === 'pencil')?.enabled).toBe(false);

    await setMcpServerEnabled(afterOff, afterOff.mcpServers.find(s => s.id === 'pencil')!, true);
    saved = await readJson(path.join(home, '.claude.json'));
    expect((saved.mcpServers as Record<string, { command: string }>).pencil.command)
      .toBe('pencil.exe');
    expect(Object.keys(saved.mcpServersDisabled as object)).toEqual([]);
  });

  it('serwer z .mcp.json wyłącza się standardowym disabledMcpjsonServers', async () => {
    const supabase = state.mcpServers.find(s => s.id === 'supabase')!;
    await setMcpServerEnabled(state, supabase, false);

    const saved = await readJson(path.join(vault, '.claude', 'settings.json'));
    expect(saved.disabledMcpjsonServers).toEqual(['supabase']);

    const afterOff = await readEnvironmentState(vault);
    expect(afterOff.mcpServers.find(s => s.id === 'supabase')?.enabled).toBe(false);
  });

  it('pusty styl kasuje klucz zamiast zapisywać pusty string', async () => {
    await setOutputStyle(configDir, null);

    const saved = await readJson(path.join(configDir, 'settings.json'));
    expect('outputStyle' in saved).toBe(false);
    expect(saved.model).toBe('opus');
  });
});
