import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PlanRateLimits } from '@/core/types';

/**
 * Konto OAuth aktywne w Claude Code. użytkownik przelacza konta w trakcie sesji, wiec
 * zapamietane limity planu moga nalezec do poprzedniego — patrz `forCurrentAccount`.
 */

const CONFIG_FILE = '.claude.json';
// ponytail: regex zamiast JSON.parse — plik ma ~120 KB, a potrzebne jest jedno pole.
const ACCOUNT_UUID = /"accountUuid"\s*:\s*"([0-9a-f-]{36})"/i;

// Email szukany TYLKO w bloku `oauthAccount` — w pliku sa tez inne pola z adresami
// (10.09 `organizationName` wzielam za konto).
const OAUTH_EMAIL = /"oauthAccount"\s*:\s*\{[^}]*?"emailAddress"\s*:\s*"([^"]+)"/;

interface AccountSnapshot {
  accountId: string | null;
  email: string | null;
}

let cache: ({ mtimeMs: number } & AccountSnapshot) | null = null;

function readAccount(): AccountSnapshot {
  const file = path.join(os.homedir(), CONFIG_FILE);
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cache?.mtimeMs === mtimeMs) return cache;
    const content = fs.readFileSync(file, 'utf8');
    cache = {
      mtimeMs,
      accountId: ACCOUNT_UUID.exec(content)?.[1] ?? null,
      email: OAUTH_EMAIL.exec(content)?.[1] ?? null,
    };
    return cache;
  } catch {
    return { accountId: null, email: null };
  }
}

/**
 * Licznik przelaczen konta, wchodzi do `restartKey` zapytania Claude. Zywy proces karty
 * pamieta tozsamosc sprzed przelaczenia i wpisuje ja z powrotem do `~/.claude.json`
 * (24.09: przelaczenie o 16:37, dwie minuty pozniej plik znow mowil o starym koncie,
 * a zapytania szly z nowego tokenu przez 5 h). Zmiana licznika = nastepna wiadomosc
 * w KAZDEJ karcie startuje swiezy proces z aktualna tozsamoscia. Tura w toku konczy sie
 * na starym procesie — przerywanie odpowiedzi byloby gorsze niz jedna tura rozjazdu,
 * ktora i tak naprawia panel kont.
 */
let accountGeneration = 0;

export function bumpAccountGeneration(): void {
  accountGeneration += 1;
}

export function getAccountGeneration(): number {
  return accountGeneration;
}

/** UUID biezacego konta z `~/.claude.json`; null gdy pliku brak albo nie ma pola. */
export function getCurrentAccountId(): string | null {
  return readAccount().accountId;
}

/** Email biezacego konta — plakietka pokazuje go nawet bez dzialajacego panelu kont. */
export function getCurrentAccountEmail(): string | null {
  return readAccount().email;
}

/**
 * Zapamietane limity, o ile naleza do konta zalogowanego TERAZ. Niezgodnosc znaczy
 * „nie pokazuj" — lepiej pusty pasek niz cudze liczby.
 */
export function forCurrentAccount(limits: PlanRateLimits | null | undefined): PlanRateLimits | null {
  if (!limits) return null;
  const current = getCurrentAccountId();
  // Brak stempla = limity sprzed tej poprawki; brak biezacego id = nie mamy z czym
  // porownac. W obu razach zaufaj zapisowi, bo alternatywa to pusty pasek na zawsze.
  if (!limits.accountId || !current) return limits;
  return limits.accountId === current ? limits : null;
}
