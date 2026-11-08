/**
 * Odczyt i zapis konfiguracji Claude Code dla panelu „Środowisko".
 *
 * Wszystko idzie do TYCH SAMYCH plików, z których czyta CLI — panel nie trzyma
 * własnego stanu. Zmiany działają od następnej sesji, bo SDK czyta konfigurację
 * przy starcie procesu agenta.
 *
 * Zapis jest atomowy (plik tymczasowy + podmiana): `writeFile` obcina cel PRZED
 * zapisem, więc pad w tym oknie kasuje konfigurację użytkownika.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import { resolveClaudeConfigDir } from '../../../providers/claude/config/ClaudeConfigDir';

export type ToggleScope = 'user' | 'project' | 'mcpjson';

export interface ToggleItem {
  id: string;
  label: string;
  detail: string;
  enabled: boolean;
  scope: ToggleScope;
}

export interface EnvironmentState {
  configDir: string;
  vaultPath: string | null;
  plugins: ToggleItem[];
  mcpServers: ToggleItem[];
  outputStyle: string | null;
  outputStyles: string[];
  hooksDisabled: boolean;
  skills: string[];
}

interface SettingsFile {
  outputStyle?: string;
  enabledPlugins?: Record<string, unknown>;
  disableAllHooks?: boolean;
  disabledMcpjsonServers?: string[];
  [key: string]: unknown;
}

interface McpEntry {
  command?: string;
  type?: string;
  url?: string;
  [key: string]: unknown;
}

interface ClaudeJsonFile {
  mcpServers?: Record<string, McpEntry>;
  /**
   * Wyłączone serwery użytkownika. Klucz WŁASNY — CLI nie ma pola „disabled"
   * dla serwerów z `~/.claude.json`, a kasowanie wpisu gubiłoby komendę i klucze.
   * CLI przepisuje ten plik w całości, więc nieznane pole po prostu przeżywa.
   */
  mcpServersDisabled?: Record<string, McpEntry>;
  projects?: Record<string, { mcpServers?: Record<string, McpEntry> }>;
  [key: string]: unknown;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.claudian-tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await fs.rename(tempPath, filePath);
}

function claudeJsonPath(configDir: string): string {
  return path.join(path.dirname(configDir), '.claude.json');
}

function describeMcp(entry: McpEntry): string {
  if (entry.url) return entry.type ?? 'http';
  if (entry.command) return `${entry.type ?? 'stdio'} · ${path.basename(entry.command)}`;
  return entry.type ?? '?';
}

/** Nazwa wtyczki bez sufiksu `@marketplace` — ten i tak jest w szczegółach. */
function pluginLabel(pluginId: string): string {
  const atIndex = pluginId.indexOf('@');
  return atIndex > 0 ? pluginId.slice(0, atIndex) : pluginId;
}

async function listSkillNames(dirPath: string): Promise<string[]> {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const names: string[] = [];
    for (const item of items) {
      if (!item.isDirectory()) continue;
      try {
        await fs.stat(path.join(dirPath, item.name, 'SKILL.md'));
        names.push(item.name);
      } catch {
        // katalog bez SKILL.md nie jest skillem
      }
    }
    return names;
  } catch {
    return [];
  }
}

async function listOutputStyles(configDir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(path.join(configDir, 'output-styles'));
    return names.filter(name => name.endsWith('.md')).map(name => name.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

export async function readEnvironmentState(vaultPath: string | null): Promise<EnvironmentState> {
  const configDir = resolveClaudeConfigDir({ vaultPath });
  const settings = await readJson<SettingsFile>(path.join(configDir, 'settings.json'));
  const projectSettings = vaultPath
    ? await readJson<SettingsFile>(path.join(vaultPath, '.claude', 'settings.json'))
    : null;
  const claudeJson = await readJson<ClaudeJsonFile>(claudeJsonPath(configDir));

  const plugins: ToggleItem[] = Object.entries(settings?.enabledPlugins ?? {}).map(
    ([id, value]) => ({
      id,
      label: pluginLabel(id),
      detail: id,
      enabled: value !== false,
      scope: 'user' as const,
    }),
  );

  const mcpServers: ToggleItem[] = [];
  for (const [name, entry] of Object.entries(claudeJson?.mcpServers ?? {})) {
    mcpServers.push({
      id: name, label: name, detail: describeMcp(entry), enabled: true, scope: 'user',
    });
  }
  for (const [name, entry] of Object.entries(claudeJson?.mcpServersDisabled ?? {})) {
    mcpServers.push({
      id: name, label: name, detail: describeMcp(entry), enabled: false, scope: 'user',
    });
  }

  if (vaultPath) {
    const shared = await readJson<{ mcpServers?: Record<string, McpEntry> }>(
      path.join(vaultPath, '.mcp.json'),
    );
    const disabled = new Set(projectSettings?.disabledMcpjsonServers ?? []);
    for (const [name, entry] of Object.entries(shared?.mcpServers ?? {})) {
      mcpServers.push({
        id: name,
        label: name,
        detail: `${describeMcp(entry)} · .mcp.json`,
        enabled: !disabled.has(name),
        scope: 'mcpjson',
      });
    }
  }

  const skills = [
    ...await listSkillNames(path.join(configDir, 'skills')),
    ...(vaultPath ? await listSkillNames(path.join(vaultPath, '.claude', 'skills')) : []),
  ];

  return {
    configDir,
    vaultPath,
    plugins: plugins.sort((a, b) => a.label.localeCompare(b.label)),
    mcpServers: mcpServers.sort((a, b) => a.label.localeCompare(b.label)),
    outputStyle: settings?.outputStyle ?? null,
    outputStyles: await listOutputStyles(configDir),
    hooksDisabled: settings?.disableAllHooks === true,
    skills: skills.sort((a, b) => a.localeCompare(b)),
  };
}

async function mutateSettings(
  filePath: string,
  mutate: (settings: SettingsFile) => void,
): Promise<void> {
  const settings = (await readJson<SettingsFile>(filePath)) ?? {};
  mutate(settings);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, settings);
}

export async function setPluginEnabled(
  configDir: string,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  await mutateSettings(path.join(configDir, 'settings.json'), settings => {
    settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [pluginId]: enabled };
  });
}

export async function setOutputStyle(configDir: string, style: string | null): Promise<void> {
  await mutateSettings(path.join(configDir, 'settings.json'), settings => {
    if (style === null) {
      delete settings.outputStyle;
      return;
    }
    settings.outputStyle = style;
  });
}

export async function setHooksDisabled(configDir: string, disabled: boolean): Promise<void> {
  await mutateSettings(path.join(configDir, 'settings.json'), settings => {
    if (disabled) {
      settings.disableAllHooks = true;
      return;
    }
    delete settings.disableAllHooks;
  });
}

export async function setMcpServerEnabled(
  state: EnvironmentState,
  item: ToggleItem,
  enabled: boolean,
): Promise<void> {
  if (item.scope === 'mcpjson') {
    if (!state.vaultPath) return;
    await mutateSettings(path.join(state.vaultPath, '.claude', 'settings.json'), settings => {
      const disabled = new Set(settings.disabledMcpjsonServers ?? []);
      if (enabled) {
        disabled.delete(item.id);
      } else {
        disabled.add(item.id);
      }
      settings.disabledMcpjsonServers = [...disabled];
    });
    return;
  }

  const filePath = claudeJsonPath(state.configDir);
  const claudeJson = (await readJson<ClaudeJsonFile>(filePath)) ?? {};
  const active = { ...(claudeJson.mcpServers ?? {}) };
  const parked = { ...(claudeJson.mcpServersDisabled ?? {}) };

  if (enabled) {
    const entry = parked[item.id];
    if (!entry) return;
    delete parked[item.id];
    active[item.id] = entry;
  } else {
    const entry = active[item.id];
    if (!entry) return;
    delete active[item.id];
    parked[item.id] = entry;
  }

  claudeJson.mcpServers = active;
  claudeJson.mcpServersDisabled = parked;
  await writeJsonAtomic(filePath, claudeJson);
}
