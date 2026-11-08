/**
 * Co Ari robi W TRAKCIE tury — czyta, mysli, pisze czy czeka na podagenta.
 * Wyliczane z fragmentow strumienia, zeby awatar mial co pokazywac miedzy
 * „zaczela" a „skonczyla" (ustalenie z użytkownikiem, 13.09).
 *
 * Celowo bez importu typu `StreamChunk`: interesuja nas dwa pola, a strukturalny
 * ksztalt trzyma ten modul testowalnym i odpornym na zmiany w unii providerow.
 */

import type { TurnSignal } from './TurnNotifier';

export interface ActivityChunk {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Narzedzia, ktore tylko patrza. Wszystko inne rusza pliki albo system, wiec
 * domyslna odpowiedzia jest „pracuje" — lepiej pokazac robote niz ja przemilczec.
 * Nazwy MCP (`mcp__serwer__narzedzie`) nie da sie tu rozstrzygnac i tez ida w prace.
 */
const READ_ONLY_TOOLS = new Set([
  'read',
  'grep',
  'glob',
  'websearch',
  'webfetch',
  'notebookread',
  'listmcpresourcestool',
  'readmcpresourcetool',
  'readmcpresourcedirtool',
  'taskoutput',
  'toolsearch',
]);

/** Narzedzia odpalajace podagenta — jego robota trwa i nie widac z niej nic. */
const SUBAGENT_TOOLS = new Set(['task', 'agent']);

/** Powloka: `Bash` i `PowerShell` to 91% wywolan w tej konfiguracji (zmierzone na
 *  transkrypcie 13.09: 584 na 641), bo czytanie plikow idzie przez `cat`/`grep`,
 *  nie przez narzedzie `Read`. Bez zajrzenia do komendy KAZDA praca wygladalaby
 *  tak samo i caly podzial nie mialby sensu. */
const SHELL_TOOLS = new Set(['bash', 'powershell', 'shell', 'run_command']);

/** Polecenia, ktore wylacznie czytaja. Wszystko spoza listy = praca. */
const READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'fgrep',
  'ls', 'dir', 'find', 'wc', 'sed', 'awk', 'cut', 'sort', 'uniq', 'diff',
  'stat', 'file', 'pwd', 'which', 'where', 'tree', 'jq', 'basename',
  'dirname', 'realpath', 'du', 'df', 'echo', 'printf', 'cd', 'column',
  'get-content', 'select-string', 'get-childitem', 'test-path',
]);

/** `git` czyta tylko przy tych podkomendach — `commit`/`push` to juz praca. */
const READ_ONLY_GIT = new Set([
  'log', 'status', 'diff', 'show', 'branch', 'remote', 'ls-files',
  'rev-parse', 'describe', 'blame', 'config',
]);

/** Zostawia same przekierowania TRESCI — `2>&1` i `>/dev/null` nic nie zapisuja. */
function writesOutput(command: string): boolean {
  const bez = command
    .replace(/2>&1/g, '')
    .replace(/&?2?>\s*(\/dev\/null|\$null|NUL)/gi, '');
  return bez.includes('>');
}

/** Czy CALA komenda powloki tylko oglada — kazdy czlon z osobna. */
export function isReadOnlyCommand(command: string): boolean {
  if (!command.trim() || writesOutput(command)) return false;
  const segmenty = command.split(/\|\||&&|;|\|/).map(c => c.trim()).filter(Boolean);
  if (segmenty.length === 0) return false;
  return segmenty.every(segment => {
    const slowa = segment.split(/\s+/);
    const glowne = (slowa[0] ?? '').toLowerCase();
    if (glowne === 'git') return READ_ONLY_GIT.has((slowa[1] ?? '').toLowerCase());
    return READ_ONLY_COMMANDS.has(glowne);
  });
}

export function activityForChunk(chunk: ActivityChunk): TurnSignal | null {
  switch (chunk.type) {
    case 'thinking':
      return { kind: 'thinking' };
    case 'text':
      return { kind: 'speaking' };
    case 'subagent_tool_use':
      return { kind: 'processing' };
    case 'tool_use': {
      const name = (chunk.name ?? '').toLowerCase();
      if (SUBAGENT_TOOLS.has(name)) return { kind: 'processing' };
      if (READ_ONLY_TOOLS.has(name)) return { kind: 'observing' };
      if (SHELL_TOOLS.has(name)) {
        const command = typeof chunk.input?.command === 'string' ? chunk.input.command : '';
        return isReadOnlyCommand(command) ? { kind: 'observing' } : { kind: 'working' };
      }
      return { kind: 'working' };
    }
    default:
      // Wyniki narzedzi, cytaty, wyjscie — nie zmieniaja tego, CO Ari robi.
      return null;
  }
}
