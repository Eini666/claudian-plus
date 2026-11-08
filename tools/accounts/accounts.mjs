#!/usr/bin/env node
// Przelaczanie kont Claude Code CLI.
// Magazyn: ~/.claude/accounts/<nazwa>/{.credentials.json, meta.json}
//
// Tryby:
//   list                 - konta w magazynie, gwiazdka = aktywne
//   add [nazwa]          - zapisz BIEZACE konto do magazynu (nazwa domyslna z emaila)
//   usage [nazwa|--all]  - stan limitow (bez palenia limitu sesji)
//   whoami               - kto jest teraz zalogowany
//   --self-check         - test logiki zapisu/odczytu

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync,
  existsSync, renameSync, rmSync, statSync, copyFileSync,
  openSync, readSync, closeSync, appendFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import * as readline from 'node:readline/promises'

const CFG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const CREDS = join(CFG, '.credentials.json')
// bez CLAUDE_CONFIG_DIR config lezy w ~/.claude.json, z nim - w samym katalogu
const CLAUDE_JSON = process.env.CLAUDE_CONFIG_DIR
  ? join(CFG, '.claude.json')
  : join(homedir(), '.claude.json')
const STORE = join(CFG, 'accounts')

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const UA = 'claude-cli/2.1.247 (external, cli)'

const die = (msg) => { console.error('BLAD: ' + msg); process.exit(1) }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

// open(w) obcina cel PRZED zapisem - przerwanie zostawia pusty plik z tokenami.
// Piszemy do .tmp i podmieniamy.
function writeJson(path, obj) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  renameSync(tmp, path)
}

function currentAccount() {
  try { return readJson(CLAUDE_JSON).oauthAccount ?? null } catch { return null }
}

function currentCreds() {
  if (!existsSync(CREDS)) return null
  try { return readJson(CREDS) } catch { return null }
}

// store jako parametr tylko dla self-checku (katalog tymczasowy)
function storedAccounts(store = STORE) {
  if (!existsSync(store)) return []
  return readdirSync(store)
    // kropka na poczatku = katalog sluzbowy (.backup), nie konto
    .filter((n) => !n.startsWith('.'))
    .filter((n) => { try { return statSync(join(store, n)).isDirectory() } catch { return false } })
    .map((name) => {
      const dir = join(store, name)
      let meta = null, creds = null
      try { creds = readJson(join(dir, '.credentials.json')) } catch {}
      try { meta = readJson(join(dir, 'meta.json')) } catch {}
      // konto zalogowane wprost w tym katalogu (CLAUDE_CONFIG_DIR=... claude auth login)
      // nie ma meta.json - tozsamosc bierzemy z jego wlasnego .claude.json
      if (!meta?.oauthAccount) {
        try { meta = { name, oauthAccount: readJson(join(dir, '.claude.json')).oauthAccount } } catch {}
      }
      return { name, dir, meta, creds }
    })
    .filter((a) => a.creds)
}

const fmtTime = (ms) => ms ? new Date(ms).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '?'

function tokenState(creds) {
  const exp = creds?.claudeAiOauth?.expiresAt
  if (!exp) return 'brak'
  return exp > Date.now() ? 'wazny do ' + fmtTime(exp) : 'WYGASL ' + fmtTime(exp)
}

// --- komendy ---------------------------------------------------------------

function ostrzezORozjezdzie() {
  const r = identityMismatch()
  if (!r) return
  console.log('')
  console.log('!! ROZJAZD TOZSAMOSCI: .claude.json mowi "' + r.mowi + '",')
  console.log('   a zywy token nalezy do "' + r.jest + '". Napraw: node accounts.mjs repair')
}

function whoami() {
  const acct = currentAccount()
  const creds = currentCreds()
  if (!creds) die('brak ' + CREDS + ' - nie jestes zalogowany')
  console.log('email: ' + (acct?.emailAddress ?? '?'))
  console.log('plan:  ' + (creds.claudeAiOauth?.subscriptionType ?? '?'))
  console.log('uuid:  ' + (acct?.accountUuid ?? '?'))
  console.log('token: ' + tokenState(creds))
}

// Nazwa konta trafia do join(STORE, name) - to granica zaufania (panel, CLI).
// Kropka na poczatku odpada w calosci: '.', '..' i nazwy katalogow sluzbowych (.backup).
const ACCOUNT_NAME_RE = /^[a-zA-Z0-9._-]{1,40}$/
function checkName(name) {
  // typeof: RegExp.test(undefined) sprawdza napis "undefined" i go przepuszcza
  if (typeof name !== 'string' || !ACCOUNT_NAME_RE.test(name) || name.startsWith('.')) {
    throw Object.assign(new Error('nazwa może mieć tylko litery, cyfry, kropkę, podkreślnik i myślnik (do 40 znaków)'), { status: 400 })
  }
  return name
}

const juzZapisane = (email, name) => 'to konto (' + (email ?? '?') + ') już jest zapisane jako „' + name + '”'
const zajetaNazwa = (name) => 'konto „' + name + '” już jest w magazynie — wybierz inną nazwę'

// Zapisuje BIEZACE konto do magazynu. Rzuca zamiast die() - panel woła to z serwera.
function saveCurrent(name, { creds = currentCreds(), acct = currentAccount(), store = STORE } = {}) {
  if (!creds?.claudeAiOauth?.accessToken) {
    throw new Error('Claude Code nie jest zalogowany — uruchom claude i zaloguj się, potem wróć tutaj')
  }
  if (!name) {
    const email = acct?.emailAddress
    if (!email) throw new Error('nie umiem odczytac emaila z .claude.json - podaj nazwe: add <nazwa>')
    name = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_')
  }
  checkName(name)
  const uuid = acct?.accountUuid
  const konta = storedAccounts(store)
  const dubel = uuid && konta.find((a) => a.name !== name && a.meta?.oauthAccount?.accountUuid === uuid)
  if (dubel) throw new Error(juzZapisane(acct.emailAddress, dubel.name))
  const dir = join(store, name)
  // ta sama nazwa + ten sam uuid = odswiezenie kopii; inne konto pod ta nazwa = nadpisanie jego tokenow
  if (existsSync(dir) && konta.find((a) => a.name === name)?.meta?.oauthAccount?.accountUuid !== uuid) {
    throw new Error(zajetaNazwa(name))
  }
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, '.credentials.json'), creds)
  writeJson(join(dir, 'meta.json'), {
    name,
    oauthAccount: acct,
    savedAt: new Date().toISOString(),
  })
  return { name, email: acct?.emailAddress ?? '?', plan: creds.claudeAiOauth?.subscriptionType ?? '?' }
}

function add(name) {
  let r
  try { r = saveCurrent(name) } catch (e) { die(e.message) }
  console.log('zapisane: ' + join(STORE, r.name))
  console.log('  email: ' + r.email)
  console.log('  plan:  ' + r.plan)
  console.log('  token: ' + tokenState(currentCreds()))
}

// Podstawianie sciezki recznie to najczestsze zrodlo pomylek przy dodawaniu konta -
// program wypisuje gotowe linie do skopiowania, z prawdziwa sciezka.
function addNew(name) {
  if (!name) {
    console.log('Podaj nazwe dla nowego konta, np.:')
    console.log('  node accounts.mjs add-new praca')
    return
  }
  try { checkName(name) } catch (e) { die(e.message) }
  if (storedAccounts().some((a) => a.name === name)) {
    die('konto "' + name + '" juz jest w magazynie - wybierz inna nazwe (albo: relogin ' + name + ')')
  }
  const dir = join(STORE, name)
  mkdirSync(dir, { recursive: true })

  console.log('')
  console.log('Katalog gotowy. Teraz SKOPIUJ i wklej do terminala te dwie linie,')
  console.log('jedna po drugiej (Wiersz polecen / cmd):')
  console.log('')
  console.log('  set CLAUDE_CONFIG_DIR=' + dir)
  console.log('  claude auth login')
  console.log('')
  console.log('Otworzy sie przegladarka. UWAGA: zaloguj sie tam na DRUGIE konto.')
  console.log('Jesli jestes juz zalogowany na claude.ai, uzyj okna prywatnego')
  console.log('(Ctrl+Shift+N w Chrome), inaczej zatwierdzi to samo konto.')
  console.log('')
  console.log('Po zalogowaniu ZAMKNIJ tamto okno terminala i sprawdz tutaj:')
  console.log('  node accounts.mjs list')
  console.log('')
}

// --- ponowne logowanie -----------------------------------------------------
// /login w zywym CLI zastepuje konto zalogowane w ~/.claude i jego token przepada
// (21.09: logowanie drugiego konta zabilo pierwsze -> ponowne logowanie 22.09).
// Dlatego logujemy do KATALOGU konta w magazynie (CLAUDE_CONFIG_DIR) - ~/.claude
// i zywe sesje zostaja nietkniete. `claude auth login` przyjmuje kod ze strony
// logowania na stdin (sprawdzone 23.09 na CLI 2.1.280), wiec da sie to zrobic z panelu.

function reloginPrep(name) {
  const a = storedAccounts().find((x) => x.name === name)
  if (!a) throw new Error('nie znam konta "' + name + '" - sprawdz: list')
  const expected = a.meta?.oauthAccount
  if (!expected?.accountUuid) throw new Error('konto "' + name + '" nie ma zapisanej tozsamosci - uzyj add-new')
  const bin = claudeBinary()
  if (!bin) throw new Error('nie znalazlam claude.exe')
  const kopia = join(STORE, '.backup', new Date().toISOString().replace(/[:.]/g, '-') + '-relogin-' + name)
  mkdirSync(kopia, { recursive: true })
  for (const f of ['.credentials.json', '.claude.json']) {
    if (existsSync(join(a.dir, f))) copyFileSync(join(a.dir, f), join(kopia, f))
  }
  return {
    a, expected, bin, kopia, verify: reloginVerify,
    args: ['auth', 'login', '--claudeai', '--email', expected.emailAddress ?? ''],
    env: { ...process.env, CLAUDE_CONFIG_DIR: a.dir },
  }
}

// --- nowe konto z panelu ---------------------------------------------------
// Ta sama droga co relogin (D2): logowanie do WLASNEGO katalogu w magazynie, ~/.claude
// nietkniete. Katalog powstaje pusty, wiec przy porazce po prostu go kasujemy.

// rm -rf tylko katalogu nowego konta: musi lezec wprost w magazynie i nie miec meta.json
function removeNewDir(dir, store = STORE) {
  if (dirname(resolve(dir)) !== resolve(store) || existsSync(join(dir, 'meta.json'))) return
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}

// Znacznik katalogu zalozonego przez panel. Serwer zatrzymany w trakcie logowania (zamkniecie
// Obsidiana, restart wtyczki) nie zdazy posprzatac - robi to nastepny start (sweepAbandoned).
// Katalogi z terminalowego add-new znacznika nie maja, wiec sprzatanie ich nie rusza.
const PANEL_LOGIN_MARK = '.panel-login'

function sweepAbandoned(store = STORE) {
  let nazwy = []
  try { nazwy = readdirSync(store) } catch { return [] }
  const usuniete = []
  for (const n of nazwy) {
    const dir = join(store, n)
    if (n.startsWith('.') || !existsSync(join(dir, PANEL_LOGIN_MARK)) || existsSync(join(dir, 'meta.json'))) continue
    removeNewDir(dir, store)
    if (!existsSync(dir)) usuniete.push(n)
  }
  return usuniete
}

function newLoginPrep(name, store = STORE) {
  checkName(name)
  const dir = join(store, name)
  if (existsSync(dir)) throw new Error(zajetaNazwa(name))
  const bin = claudeBinary()
  if (!bin) throw new Error('nie znalazlam claude.exe')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PANEL_LOGIN_MARK), new Date().toISOString())
  let sprzatniete = false
  return {
    name, dir, store, bin, verify: newLoginVerify,
    // jednorazowo: stary proces po kill() konczy sie pozniej, gdy pod ta nazwa moze juz trwac nowa proba
    cleanup: () => { if (!sprzatniete) { sprzatniete = true; removeNewDir(dir, store) } },
    args: ['auth', 'login', '--claudeai'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  }
}

function newLoginVerify({ name, dir, store = STORE }) {
  const fail = (m) => { removeNewDir(dir, store); throw new Error(m) }
  let acct = null
  try { acct = readJson(join(dir, '.claude.json')).oauthAccount } catch {}
  const creds = (() => { try { return readJson(join(dir, '.credentials.json')) } catch { return null } })()
  if (!creds?.claudeAiOauth?.refreshToken) fail('logowanie nie zapisało tokenu')
  if (!acct?.accountUuid) fail('logowanie nie zapisało tożsamości konta (.claude.json)')
  const dubel = storedAccounts(store).find((a) => a.name !== name && a.meta?.oauthAccount?.accountUuid === acct.accountUuid)
  if (dubel) fail(juzZapisane(acct.emailAddress, dubel.name))
  writeJson(join(dir, 'meta.json'), { name, oauthAccount: acct, savedAt: new Date().toISOString() })
  rmSync(join(dir, PANEL_LOGIN_MARK), { force: true })
  if (store === STORE) logLine('DODANO z panelu ' + name + ' (' + (acct.emailAddress ?? '?') + ')')
  return { name, email: acct.emailAddress ?? '?' }
}

// Przegladarka loguje konto, ktore jest w niej zalogowane na claude.ai - latwo o pomylke.
// Zle konto pod ta nazwa = rozjazd tozsamosci, wiec wtedy przywracamy stan sprzed proby.
function reloginVerify({ a, expected, kopia }) {
  let got = null
  try { got = readJson(join(a.dir, '.claude.json')).oauthAccount } catch {}
  const creds = (() => { try { return readJson(join(a.dir, '.credentials.json')) } catch { return null } })()
  const blad = !creds?.claudeAiOauth?.refreshToken ? 'logowanie nie zapisalo tokenu'
    : got?.accountUuid !== expected.accountUuid
      ? 'zalogowane INNE konto (' + (got?.emailAddress ?? '?') + ') - zaloguj ' + expected.emailAddress + ' w oknie prywatnym'
      : null
  if (blad) {
    for (const f of ['.credentials.json', '.claude.json']) {
      if (existsSync(join(kopia, f))) copyFileSync(join(kopia, f), join(a.dir, f))
    }
    throw new Error(blad + '; poprzedni stan przywrocony')
  }
  deadRefresh.delete(a.name)
  usageCache.delete(a.name)
  rateLimited.delete(a.name)
  saveCache()
  // konto aktywne: nowy token musi trafic tez do ~/.claude, inaczej CLI dalej ma martwy
  let aktywne = false
  if (currentAccount()?.accountUuid === expected.accountUuid && !identityMismatch()) {
    if (existsSync(CREDS)) copyFileSync(CREDS, join(kopia, 'zywy-.credentials.json'))
    writeJson(CREDS, creds)
    aktywne = true
  }
  logLine('ZALOGOWANO ponownie ' + a.name + (aktywne ? ' (aktywne - token wgrany do ~/.claude)' : ''))
  return { email: expected.emailAddress, aktywne, loginExpiresAt: creds.claudeAiOauth.refreshTokenExpiresAt ?? null }
}

function reloginCmd(name) {
  if (!name) die('podaj nazwe: relogin <nazwa>')
  let p
  try { p = reloginPrep(name) } catch (e) { die(e.message) }
  console.log('Loguje ' + name + ' (' + p.expected.emailAddress + ') do ' + p.a.dir)
  console.log('~/.claude i zywe sesje zostaja nietkniete.')
  console.log('Jesli przegladarka ma zalogowane INNE konto: otworz ponizszy link w oknie prywatnym.\n')
  const r = spawnSync(p.bin, p.args, { env: p.env, stdio: 'inherit' })
  if (r.status !== 0) die('logowanie przerwane (kod ' + r.status + ')')
  try {
    const w = reloginVerify(p)
    console.log('\nzalogowane: ' + w.email + ', logowanie do ' + fmtTime(w.loginExpiresAt))
    if (w.aktywne) console.log('konto aktywne - nowy token wgrany tez do ~/.claude')
  } catch (e) { die(e.message) }
}

// Panel: start zwraca link, finish wkleja kod. Proces czeka miedzy nimi.
const RELOGIN_TTL_MS = 10 * 60_000
const pendingLogin = new Map() // nazwa -> { p, proc, out, done }

// Relogin i nowe konto roznia sie tylko prep (co i gdzie logujemy) i p.verify.
// p.cleanup ma tylko nowe konto: kasuje katalog, gdy logowanie konczy sie bez sukcesu.
function reloginStart(name) { return loginStart(name, reloginPrep) }
function newLoginStart(name) { return loginStart(name, newLoginPrep) }

function loginCancel(name) {
  const st = pendingLogin.get(name)
  if (!st?.p.cleanup) return
  try { st.proc.kill() } catch {}
  pendingLogin.delete(name)
  st.p.cleanup()
}

function loginStart(name, prep) {
  const stary = pendingLogin.get(name)
  if (stary) { try { stary.proc.kill() } catch {} pendingLogin.delete(name); stary.p.cleanup?.() }
  const p = prep(name)
  const proc = spawn(p.bin, p.args, { env: p.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const st = { p, proc, out: '' }
  st.done = new Promise((res) => proc.on('exit', (code) => res(code)))
  proc.on('error', () => {}) // blad spawnu konczy sie exit/zamknieciem - obslugujemy tam
  proc.stdin.on('error', () => {}) // EPIPE po smierci procesu nie moze polozyc serwera
  const timer = setTimeout(() => { try { proc.kill() } catch {} }, RELOGIN_TTL_MS)
  st.done.then(() => {
    clearTimeout(timer)
    if (pendingLogin.get(name) === st) pendingLogin.delete(name)
    // wyjscie po wklejeniu kodu rozstrzyga finish (verify); kazde inne = porazka (TTL, blad, kill)
    if (!st.finishing) p.cleanup?.()
  })
  pendingLogin.set(name, st)
  return new Promise((resolve, reject) => {
    const koniec = setTimeout(() => { try { proc.kill() } catch {} reject(new Error('claude nie podal linku w 20 s')) }, 20_000)
    const on = (d) => {
      st.out += d
      // link z --email (relogin) i bez (nowe konto) ma te sama sciezke oauth/authorize
      const m = st.out.match(/https:\/\/\S+oauth\/authorize\S+/)
      if (m) { clearTimeout(koniec); resolve({ url: m[0], email: p.expected?.emailAddress }) }
    }
    proc.stdout.on('data', on)
    proc.stderr.on('data', on)
    st.done.then((code) => { clearTimeout(koniec); reject(new Error('claude zakonczyl sie przed podaniem linku (kod ' + code + ')')) })
  })
}

async function reloginFinish(name, code) {
  const st = pendingLogin.get(name)
  if (!st) throw new Error('brak trwajacego logowania dla "' + name + '" - zacznij od nowa')
  if (typeof code !== 'string' || !code.trim()) throw new Error('pusty kod')
  const przed = st.out.length
  st.finishing = true
  st.proc.stdin.write(code.trim() + '\n')
  const exit = await Promise.race([st.done, new Promise((r) => setTimeout(() => r('timeout'), 60_000))])
  if (exit === 'timeout') { try { st.proc.kill() } catch {} st.p.cleanup?.(); throw new Error('claude nie odpowiedzial w 60 s') }
  if (exit !== 0) {
    st.p.cleanup?.()
    const powod = st.out.slice(przed).trim().split('\n').pop() || 'kod ' + exit
    throw new Error('logowanie nieudane: ' + powod + ' - zacznij od nowa')
  }
  return st.p.verify(st.p)
}

async function refreshCmd(name) {
  if (!name) die('podaj nazwe: refresh <nazwa>')
  const a = storedAccounts().find((x) => x.name === name)
  if (!a) die('nie znam konta "' + name + '" - sprawdz: list')
  console.log('przed:  ' + tokenState(a.creds))
  const r = await refreshAccount(a)
  if (!r.ok) {
    console.log('NIE UDALO SIE: ' + r.reason)
    if (r.backup) console.log('  kopia sprzed proby: ' + r.backup)
    process.exit(1)
  }
  console.log('po:     ' + tokenState(r.creds))
  console.log('  refresh token ' + (r.rotated ? 'ZROTOWANY (stary uniewazniony)' : 'bez zmian'))
  if (r.aktywne) console.log('  konto AKTYWNE - nowy token zapisany takze do ~/.claude')
  console.log('  kopia: ' + r.backup)
}

function oauthInfo() {
  const t0 = Date.now()
  const c = oauthConfig()
  console.log('client_id: ' + c.clientId)
  console.log('token_url: ' + c.tokenUrl)
  console.log('z binarki: ' + (c.bin ?? '?'))
  console.log('odczyt:    ' + (Date.now() - t0) + ' ms' + (c.at ? '  (cache z ' + c.at + ')' : ''))
}

function list() {
  const accounts = storedAccounts()
  if (!accounts.length) { console.log('magazyn pusty (' + STORE + ')'); return }
  const cur = currentAccount()
  for (const a of accounts) {
    const active = cur?.accountUuid && a.meta?.oauthAccount?.accountUuid === cur.accountUuid
    console.log(
      (active ? '* ' : '  ') + a.name.padEnd(16) +
      (a.meta?.oauthAccount?.emailAddress ?? '?').padEnd(28) +
      tokenState(a.creds) + '  logowanie do ' + fmtTime(a.creds?.claudeAiOauth?.refreshTokenExpiresAt)
    )
  }
  console.log('\n* = konto aktywne w CLI')
}

// fetch bez limitu czasu potrafi wisiec w nieskonczonosc. Tick auto-switcha trzyma
// wtedy swojego straznika `autoTicking` i CALA automatyka umiera po cichu - 13.09
// dalo to 2h23m ciszy w logu, zuzycie 43% -> 100% i zero prob przelaczenia.
const FETCH_TIMEOUT_MS = 15_000

async function fetchUsage(token) {
  const res = await fetch(USAGE_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Authorization: 'Bearer ' + token,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': UA,
    },
  })
  if (!res.ok) return { error: 'HTTP ' + res.status }
  return res.json()
}

// z odpowiedzi bierzemy tylko to, co panel pokazuje - reszta to szum.
// opus/sonnet bywaja null (konto bez osobnego limitu per model) - panel je wtedy pomija
function slimUsage(u) {
  if (u.error) return u
  const pick = (o) => o ? { pct: o.utilization, resetsAt: o.resets_at } : null
  return {
    session: pick(u.five_hour),
    weekly: pick(u.seven_day),
    opus: pick(u.seven_day_opus),
    sonnet: pick(u.seven_day_sonnet),
  }
}

async function usage(arg) {
  const cur = currentAccount()
  const targets = []
  if (!arg || arg === '--all') {
    const accounts = storedAccounts().map((a) => useLiveCreds(a, cur))
    if (!accounts.length) {
      const creds = currentCreds()
      if (!creds) die('magazyn pusty i brak aktywnego konta')
      targets.push({ name: '(aktywne)', creds, meta: { oauthAccount: currentAccount() } })
    } else targets.push(...accounts)
  } else {
    const a = storedAccounts().find((x) => x.name === arg)
    if (!a) die('nie znam konta "' + arg + '" - sprawdz: list')
    targets.push(useLiveCreds(a, cur))
  }

  for (const t of targets) {
    const token = t.creds?.claudeAiOauth?.accessToken
    const email = t.meta?.oauthAccount?.emailAddress ?? '?'
    if (!token) { console.log(t.name + ' (' + email + '): brak tokenu'); continue }
    const u = slimUsage(await fetchUsage(token))
    if (u.error) { console.log(t.name + ' (' + email + '): ' + u.error); continue }
    console.log(t.name + ' (' + email + ')')
    console.log('  sesja 5h: ' + u.session.pct + '%  reset ' + fmtTime(Date.parse(u.session.resetsAt)))
    console.log('  tydzien:  ' + u.weekly.pct + '%  reset ' + fmtTime(Date.parse(u.weekly.resetsAt)))
  }
}

// Aplikacja desktopowa Claude (Microsoft Store) ma plik o TEJ SAMEJ nazwie co CLI
// i chodzi jako Electron: proces glowny + renderer/gpu/utility/crashpad. Liczenie po
// samej nazwie dawalo 13 zamiast 1 i strzelalo falszywym ostrzezeniem przed kazdym
// przelaczeniem konta. Desktop ma wlasny magazyn tokenow (config.json ->
// oauth:tokenCacheV2), wiec podmiany credentials CLI w ogole nie dotyka.
const SCIEZKI_SPOZA_CLI = /\\WindowsApps\\/i

function claudeProcessCount() {
  // Sciezki daje dopiero CIM; tasklist zna wylacznie nazwy obrazu.
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | "
      + 'Select-Object -ExpandProperty ExecutablePath',
    ], { encoding: 'utf8', timeout: 5000 })

    const sciezki = out.split('\n').map((l) => l.trim()).filter(Boolean)
    // Pusty wynik przy zywym CLI znaczylby, ze zapytanie zawiodlo po cichu —
    // wtedy lepiej spasc na tasklist niz zameldowac zero.
    if (sciezki.length > 0) return sciezki.filter((p) => !SCIEZKI_SPOZA_CLI.test(p)).length
  } catch { /* brak PowerShella albo timeout — nizej stara droga */ }

  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/NH'], { encoding: 'latin1' })
    return out.split('\n').filter((l) => /claude\.exe/i.test(l)).length
  } catch { return 0 }
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return /^(t|tak|y|yes)$/i.test(answer.trim())
}

// kopia obu plikow przed kazda podmiana - jedyna droga powrotu, gdy cos pojdzie zle
function backupCurrent() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(STORE, '.backup', stamp)
  mkdirSync(dir, { recursive: true })
  for (const src of [CREDS, CLAUDE_JSON]) {
    if (existsSync(src)) copyFileSync(src, join(dir, src.split(/[\\/]/).pop()))
  }
  return dir
}

// token biezacego konta mogl sie odswiezyc od czasu 'add' - zapisujemy go z powrotem,
// inaczej magazyn trzyma martwa kopie
/**
 * ROZJAZD TOZSAMOSCI: `~/.claude.json` mowi, ze aktywne jest konto A, a zywy token
 * w `~/.claude/.credentials.json` nalezy do konta B.
 *
 * Skad sie bierze: `doSwitch` zapisuje oba pliki naraz, ale ZYWA SESJA claude.exe
 * trzyma swoja tozsamosc w pamieci i stempluje ja z powrotem do `.claude.json`
 * przy kolejnym zapisie konfiguracji. Ten kod sam o tym ostrzega przy przelaczaniu
 * („zywa sesja moze nadpisac podmienione tokeny") — okazalo sie, ze tak samo dotyczy
 * to pola tozsamosci (zlapane 13.09.2026: panel pokazywal zuzycie drugiego konta pod
 * OBIEMA nazwami, bo aktywnemu koncie podstawiano cudzy zywy token).
 *
 * Sprawdzamy ZACHOWAWCZO: alarm tylko wtedy, gdy zywy token jest DOKLADNIE tokenem
 * innego konta z magazynu. Sam fakt, ze rozni sie od zapisanego, jest normalny —
 * zywa sesja odswieza token, a `useLiveCreds` dopisuje go potem do magazynu.
 */
function identityMismatch() {
  const cur = currentAccount()
  const live = currentCreds()?.claudeAiOauth?.accessToken
  if (!cur?.accountUuid || !live) return null
  const wlasciciel = storedAccounts().find((a) => a.creds?.claudeAiOauth?.accessToken === live)
  if (!wlasciciel) return null // token swiezszy niz magazyn - normalna praca
  const uuid = wlasciciel.meta?.oauthAccount?.accountUuid
  if (!uuid || uuid === cur.accountUuid) return null
  return {
    konto: wlasciciel.name,
    jest: wlasciciel.meta?.oauthAccount?.emailAddress ?? '?',
    mowi: cur.emailAddress ?? '?',
    acct: wlasciciel.meta.oauthAccount,
  }
}

function syncBackCurrent() {
  const cur = currentAccount()
  const creds = currentCreds()
  if (!cur?.accountUuid || !creds) return null
  // CLI po wygasnieciu logowania kasuje tokeny z pliku (21.09 19:08) - taka "kopia"
  // nadpisalaby w magazynie jedyny slad konta niczym
  if (!creds.claudeAiOauth?.refreshToken) return null
  // Przy rozjezdzie tozsamosci zapisalibysmy token konta B do katalogu konta A
  // i zniszczyli jego dane logowania. Lepiej nie zapisac nic.
  if (identityMismatch()) return null
  const slot = storedAccounts().find((a) => a.meta?.oauthAccount?.accountUuid === cur.accountUuid)
  if (!slot) return null
  writeJson(join(slot.dir, '.credentials.json'), creds)
  return slot.name
}

/**
 * Uzgadnia tozsamosc w `.claude.json` z kontem, do ktorego NAPRAWDE nalezy zywy token.
 * Nie rusza samego tokenu, wiec zywa sesja pracuje dalej bez przerwy - zmienia sie
 * wylacznie zapis „kto jest zalogowany", ktory i tak byl nieprawdziwy.
 *
 * Od 24.09 robi to takze auto-switch. Wczesniej rozjazd tylko go zatrzymywal: przelaczenie
 * w Claudianie o 16:37, zywy proces karty wpisal z pamieci stare konto, plakietka przez
 * 5 h pokazywala pierwsze konto, a limit schodzil z drugiego - bez przelaczenia i bez
 * ostrzezenia. Rozjazd znaczy zawsze, ze klamie plik tozsamosci, a prawde niesie token,
 * wiec naprawa niczego nie psuje.
 */
let lastRepair = null // { at, from, to } - panel pokazuje to plakietce Claudiana

function repairIdentity(zrodlo) {
  const r = identityMismatch()
  if (!r) return null
  // Zywa sesja potrafi wpisywac stare konto w kolko - wtedy naprawa co tick robilaby kopie
  // i linie logu co minute (22.09 podobna petla dala 309 kopii). Powtorke w 10 min tylko liczymy.
  const powtorka = lastRepair && lastRepair.from === r.mowi && lastRepair.to === r.jest &&
    Date.now() - lastRepair.at < 10 * 60_000
  const kopia = powtorka ? null : backupCurrent()
  const cfg = existsSync(CLAUDE_JSON) ? readJson(CLAUDE_JSON) : {}
  cfg.oauthAccount = r.acct
  writeJson(CLAUDE_JSON, cfg)
  usageCache.delete(r.konto)
  rateLimited.delete(r.konto)
  saveCache()
  if (powtorka) {
    lastRepair.count = (lastRepair.count ?? 1) + 1
  } else {
    lastRepair = { at: Date.now(), from: r.mowi, to: r.jest, count: 1 }
    logLine('NAPRAWIONO tozsamosc [' + zrodlo + ']: ' + r.mowi + ' -> ' + r.jest)
  }
  return { ...r, kopia }
}

function doRepair() {
  const r = repairIdentity('cli')
  if (!r) { console.log('stan spojny - nie ma czego naprawiac'); return }
  console.log('ROZJAZD: .claude.json mowil "' + r.mowi + '", a zywy token nalezy do "' + r.jest + '"')
  console.log('naprawione: aktywne konto to teraz ' + r.konto + ' (' + r.jest + ')')
  console.log('  kopia: ' + r.kopia)
  console.log('  token NIE byl ruszany - zywa sesja dziala dalej')
}

// rzuca zamiast konczyc proces - w trybie serve blad nie moze zabic serwera
async function doSwitch(name, { yes = false, source = 'cli' } = {}) {
  const bad = (m) => { throw new Error(m) }
  if (!name) bad('podaj nazwe: switch <nazwa>')
  const target = storedAccounts().find((a) => a.name === name)
  if (!target) bad('nie znam konta "' + name + '" - sprawdz: list')
  const targetAcct = target.meta?.oauthAccount
  if (!targetAcct?.accountUuid) bad('konto "' + name + '" nie ma tozsamosci w meta.json ani .claude.json')
  if (!target.creds?.claudeAiOauth?.accessToken) bad('konto "' + name + '" nie ma tokenu')

  const cur = currentAccount()
  if (cur?.accountUuid === targetAcct.accountUuid) {
    console.log('juz jestes na koncie ' + name + ' (' + (targetAcct.emailAddress ?? '?') + ')')
    return
  }

  const running = claudeProcessCount()
  if (running > 0 && !yes) {
    console.log('UWAGA: dziala ' + running + ' proces(ow) claude.exe.')
    console.log('Zywa sesja moze nadpisac podmienione tokeny przy odswiezeniu.')
    if (!await confirm('Przelaczyc mimo to? [tak/nie] ')) { console.log('anulowane'); return }
  }

  // Konto docelowe lezalo bezczynnie - jego token mogl umrzec. Odswiezamy PRZED
  // podmiana, inaczej uzytkownik dostaje w CLI twarde "login required" (30.08).
  let target2 = target
  if ((target.creds?.claudeAiOauth?.expiresAt ?? 0) < Date.now() + 60_000) {
    console.log('token konta "' + name + '" wygasl - odswiezam...')
    const r = await refreshAccount(target)
    if (r.ok) {
      target2 = { ...target, creds: r.creds }
      console.log('  odswiezony: ' + tokenState(r.creds))
    } else {
      console.log('  NIE UDALO SIE: ' + r.reason)
      // Panel i auto-switch nie pytaja - bez tej bramki wgrywaly do CLI martwy token
      // i uzytkownik dostawal "login required" (22.09 18:10).
      if (yes && r.dead) bad('konto "' + name + '" wymaga ponownego logowania (' + r.reason + ') - node accounts.mjs relogin ' + name)
      if (!yes && !await confirm('Przelaczyc mimo to (bedzie wymagane logowanie)? [tak/nie] ')) {
        console.log('anulowane'); return
      }
    }
  }

  const backup = backupCurrent()
  const saved = syncBackCurrent()
  if (!saved && cur) {
    console.log('UWAGA: biezace konto (' + (cur.emailAddress ?? '?') + ') nie jest w magazynie -')
    console.log('       jego token zostaje tylko w kopii ' + backup)
  }

  writeJson(CREDS, target2.creds)
  const cfg = existsSync(CLAUDE_JSON) ? readJson(CLAUDE_JSON) : {}
  cfg.oauthAccount = targetAcct
  writeJson(CLAUDE_JSON, cfg)

  // Cache zyje godzine, wiec zaraz po przelaczeniu panel pokazywalby liczby konta
  // docelowego sprzed nawet 60 minut — wygladalo to, jakby przelacznik nie zadzialal.
  // Unieważniamy oba konta: docelowe chcemy zobaczyc swieze, zrodlowe zamarlo w chwili
  // podmiany. Backoff tez znika, bo 429 dotyczyl poprzedniego tokenu.
  usageCache.delete(name)
  rateLimited.delete(name)
  if (saved) {
    usageCache.delete(saved)
    rateLimited.delete(saved)
  }
  saveCache()
  // Automat pisze wlasne PRZELACZONO z procentami. Reczne przelaczenia nie zostawialy
  // sladu i 24.09 nie dalo sie ustalic, co przelaczylo konto o 16:37.
  if (source !== 'auto') logLine('RECZNIE [' + source + '] ' + (cur?.emailAddress ?? '?') + ' -> ' + (targetAcct.emailAddress ?? name))

  console.log('przelaczono na: ' + name + ' (' + (targetAcct.emailAddress ?? '?') + ')')
  console.log('  token: ' + tokenState(target2.creds))
  if (saved) console.log('  stan konta ' + saved + ' zapisany w magazynie')
  console.log('  kopia:  ' + backup)
  console.log('  cache zuzycia wyczyszczony - panel pobierze swieze liczby')
}

// PRAWDZIWE odswiezanie tokenu. `claude auth status` go NIE odswieza (sprawdzone 28.08) -
// wymiana idzie przez OAuth. Oba parametry wyjete z binarki CLI, z tej samej struktury
// konfiguracyjnej: CLIENT_ID + TOKEN_URL.
// client_id i TOKEN_URL to STALE APLIKACJI Claude Code (nie sekrety uzytkownika - w OAuth
// client_id jest publiczny), ale zmieniaja sie miedzy wersjami CLI. Czytamy je z binarki
// zainstalowanej u uzytkownika zamiast wpisywac na sztywno: po aktualizacji Claude Code
// narzedzie dalej dziala, zamiast paso cicho na 400.
function claudeBinary() {
  const kandydaci = [
    join(homedir(), '.local', 'bin', 'claude.exe'),
    join(homedir(), '.local', 'bin', 'claude'),
  ]
  try {
    const rr = join(homedir(), 'AppData', 'Roaming', 'Claude', 'claude-code')
    if (existsSync(rr)) {
      for (const w of readdirSync(rr).sort().reverse()) {
        kandydaci.push(join(rr, w, 'claude.exe'))
      }
    }
  } catch {}
  try {
    const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'],
      { encoding: 'utf8', timeout: 10_000 }).split('\n').map((s) => s.trim()).filter(Boolean)
    kandydaci.push(...which)
  } catch {}
  return kandydaci.find((p) => { try { return statSync(p).isFile() } catch { return false } }) ?? null
}

// Binarka ma ~250 MB - czytamy ja kawalkami z zakladka, zeby wzorzec nie zginal na styku.
function skanujBinarke(path, wzorce) {
  const KAWALEK = 4 * 1024 * 1024, ZAKLADKA = 1024
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(KAWALEK + ZAKLADKA)
  const znalezione = {}
  try {
    let poz = 0, ogon = ''
    for (;;) {
      const n = readSync(fd, buf, 0, KAWALEK, poz)
      if (n <= 0) break
      const tekst = ogon + buf.subarray(0, n).toString('latin1')
      for (const [klucz, re] of Object.entries(wzorce)) {
        if (znalezione[klucz]) continue
        const m = tekst.match(re)
        if (m) znalezione[klucz] = m[1]
      }
      if (Object.keys(znalezione).length === Object.keys(wzorce).length) break
      ogon = tekst.slice(-ZAKLADKA)
      poz += n
    }
  } finally { closeSync(fd) }
  return znalezione
}

let oauthCache = null

function oauthConfig() {
  if (oauthCache) return oauthCache
  const plik = join(STORE, '.oauth-config.json')

  const bin = claudeBinary()
  if (!bin) throw new Error('nie znalazlem binarki claude - zainstaluj Claude Code albo dodaj ja do PATH')
  const st = statSync(bin)

  // Cache wiazemy ze STANEM BINARKI, nie z samym faktem odczytu. Claude Code aktualizuje
  // sie nawet co kilka dni (2.1.247 -> 2.1.251 w dwie doby); wieczny cache trzymalby
  // wartosc z poprzedniej wersji i refresh padalby na 400 bez powodu widocznego dla usera.
  try {
    const c = readJson(plik)
    if (c.clientId && c.tokenUrl && c.bin === bin && c.binSize === st.size && c.binMtime === st.mtimeMs) {
      return (oauthCache = c)
    }
  } catch {}

  // Wersja produkcyjna ma literaly; wariant z szablonami (${...}) to tryb deweloperski
  // i nalezy do innego client_id (Console/API) - stad dokladny adres w dopasowaniu.
  const w = skanujBinarke(bin, {
    clientId: /MANUAL_REDIRECT_URL:"https:\/\/platform\.claude\.com\/oauth\/code\/callback",CLIENT_ID:"([0-9a-f-]{36})"/,
    tokenUrl: /TOKEN_URL:"(https:\/\/[^"]+\/v1\/oauth\/token)"/,
  })
  if (!w.clientId || !w.tokenUrl) {
    throw new Error('nie odczytalem konfiguracji OAuth z ' + bin + ' - zmienil sie format binarki?')
  }
  const zapis = { ...w, bin, binSize: st.size, binMtime: st.mtimeMs, at: new Date().toISOString() }
  try { mkdirSync(STORE, { recursive: true }); writeJson(plik, zapis) } catch {}
  return (oauthCache = zapis)
}

// Serwer moze ZROTOWAC refresh token (wydac nowy, uniewaznic stary). Dlatego przed
// wymiana robimy kopie, a wynik zapisujemy atomowo - urwanie w polowie kosztuje
// ponowne logowanie.
// Odrzucony refresh token juz nie ozyje - ponawianie go co minute dawalo 309 prob
// (i 309 katalogow kopii) 22.09, a panel w tym czasie pokazywal stare liczby z cache
// i "odswiezy sie po przelaczeniu". Pamietamy odmowe per konto, kluczem jest sam
// token: po ponownym logowaniu w magazynie lezy nowy i proby wracaja same.
const deadRefresh = new Map() // nazwa konta -> { rt, reason }

async function refreshAccount(account) {
  const oauth = account.creds?.claudeAiOauth
  const rt = oauth?.refreshToken
  if (!rt) return { ok: false, dead: true, reason: 'brak refresh tokenu' }
  // Logowanie zyje ~4 tygodnie OD ZALOGOWANIA - rotacja tokenu go nie przedluza
  // (21.09 drugie konto padlo dokladnie w dniu z refreshTokenExpiresAt).
  if ((oauth.refreshTokenExpiresAt ?? 0) < Date.now()) {
    return { ok: false, dead: true, reason: 'logowanie wygasło' }
  }
  const znany = deadRefresh.get(account.name)
  if (znany?.rt === rt) return { ok: false, dead: true, reason: znany.reason }

  const backupDir = join(STORE, '.backup', new Date().toISOString().replace(/[:.]/g, '-') + '-refresh-' + account.name)
  mkdirSync(backupDir, { recursive: true })
  copyFileSync(join(account.dir, '.credentials.json'), join(backupDir, '.credentials.json'))

  let res, body
  try {
    const cfg = oauthConfig()
    res = await fetch(cfg.tokenUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': UA },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt, client_id: cfg.clientId }),
    })
    body = await res.json().catch(() => null)
  } catch (e) {
    return { ok: false, reason: 'sieć: ' + e.message, backup: backupDir }
  }
  if (!res.ok || !body?.access_token) {
    const reason = 'HTTP ' + res.status + (body?.error ? ' ' + body.error : '')
    // 4xx (poza 429) = serwer odrzucil token na stale; 5xx i 429 moga minac same
    const dead = res.status >= 400 && res.status < 500 && res.status !== 429
    if (dead) {
      deadRefresh.set(account.name, { rt, reason })
      logLine('MARTWY TOKEN ' + account.name + ': ' + reason + ' - wymaga ponownego logowania')
    }
    return { ok: false, dead, reason, backup: backupDir }
  }
  deadRefresh.delete(account.name)

  const fresh = {
    ...account.creds,
    claudeAiOauth: {
      ...oauth,
      accessToken: body.access_token,
      // serwer nie zawsze oddaje nowy refresh - wtedy stary zostaje wazny
      refreshToken: body.refresh_token ?? rt,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      ...(body.refresh_token && body.refresh_expires_in
        ? { refreshTokenExpiresAt: Date.now() + body.refresh_expires_in * 1000 }
        : {}),
      ...(body.scope ? { scopes: body.scope.split(' ') } : {}),
    },
  }
  writeJson(join(account.dir, '.credentials.json'), fresh)

  // 🔴 Serwer ROTUJE token: stary przestaje dzialac w chwili wydania nowego. Jesli
  // odswiezamy konto AKTYWNE, a nowy token trafi tylko do magazynu, to ~/.claude zostaje
  // z uniewaznionym kluczem i CLI zada ponownego logowania (31.08: dokladnie tak sie stalo).
  // Aktywne konto musi dostac nowy token w OBU miejscach, jednym ruchem.
  const cur = currentAccount()
  const aktywne = cur?.accountUuid && account.meta?.oauthAccount?.accountUuid === cur.accountUuid
  if (aktywne) {
    try {
      copyFileSync(CREDS, join(backupDir, 'zywy-.credentials.json'))
      writeJson(CREDS, fresh)
    } catch (e) {
      return { ok: false, reason: 'token odswiezony, ale NIE zapisany do ~/.claude: ' + e.message
        + ' - skopiuj recznie z ' + join(account.dir, '.credentials.json'), backup: backupDir }
    }
  }
  return { ok: true, creds: fresh, rotated: !!body.refresh_token, backup: backupDir, aktywne: !!aktywne }
}

// Claude Code odswieza token AKTYWNEGO konta sam, ale zapisuje go do ~/.claude,
// nie do magazynu - kopia w magazynie starzeje sie i po dobie jest martwa.
// Bierzemy zywy plik i dogrywamy go do magazynu.
function useLiveCreds(account, cur) {
  const mine = cur?.accountUuid && account.meta?.oauthAccount?.accountUuid === cur.accountUuid
  if (!mine) return account
  // Zywy token nalezy do KOGO INNEGO - podstawienie go tutaj pokazaloby zuzycie
  // cudzego konta pod nazwa tego. Zostajemy przy tokenie z magazynu.
  if (identityMismatch()) return account
  const live = currentCreds()
  if (!live?.claudeAiOauth?.accessToken) return account
  const stored = account.creds?.claudeAiOauth?.expiresAt ?? 0
  if ((live.claudeAiOauth.expiresAt ?? 0) > stored) {
    try { writeJson(join(account.dir, '.credentials.json'), live) } catch {}
  }
  return { ...account, creds: live }
}

// /api/oauth/usage ma ostry rate limit i oddaje 'Retry-After: 0', wiec czas czekania
// ustalamy sami. Ostatnia udana odpowiedz zostaje - lepiej pokazac dane sprzed kilku
// minut niz czerwony blad.
const usageCache = new Map() // nazwa konta -> { at, data }
// TTL zalezy od tego, jak blisko limitu jestesmy. Staly 5-minutowy pokazywal uzytkownikowi
// "28%" w chwili, gdy konto mialo juz 88%, wiec limit padal mu "w minute" (06.09).
// Blisko progu pytamy czesciej; daleko od niego dane sprzed kilku minut nikomu nie szkodza.
// Gorna czestotliwosc trzymamy PONIZEJ 60 s/konto - tyle wystarczylo, zeby 28.08 dostac 429.
function ttlFor(data) {
  const pct = Math.max(data?.session?.pct ?? 0, data?.weekly?.pct ?? 0)
  if (pct >= 85) return 90_000
  if (pct >= 70) return 3 * 60_000
  return 5 * 60_000
}
const RL_BACKOFF = 3 * 60_000
const CACHE_FILE = join(STORE, '.usage-cache.json')
// backoff PER KONTO - martwy token tez zwraca 429 (Anthropic mapuje go na rate_limit_error),
// wiec globalny licznik pozwalal jednemu zepsutemu kontu zablokowac wszystkie zdrowe
const rateLimited = new Map() // nazwa konta -> timestamp do kiedy nie pytac

// cache przezywa restart serwera - inaczej po kazdym restarcie panel przez kilka minut
// pokazuje blad zamiast ostatnich znanych liczb
function loadCache() {
  try {
    for (const [k, v] of Object.entries(readJson(CACHE_FILE))) usageCache.set(k, v)
  } catch {}
}
function saveCache() {
  try { writeJson(CACHE_FILE, Object.fromEntries(usageCache)) } catch {}
}

async function usageFor(name, token, expired = false) {
  const hit = usageCache.get(name)
  const fresh = hit && Date.now() - hit.at < ttlFor(hit.data)
  // 'cache' oznaczamy TYLKO gdy to ratunek po odmowie API - swiezy cache to normalna praca
  const withAge = (src) => ({ ...hit.data, ageMs: Date.now() - hit.at, ...(src && { source: src }) })

  // kolejnosc zrodel: cache -> API -> blad
  const fallback = (err) => hit ? withAge('cache') : { error: err }

  if (!token) return { error: 'brak tokenu' }
  if (fresh) return withAge()
  if (Date.now() < (rateLimited.get(name) ?? 0)) return fallback('limit odczytów — spróbuj za chwilę')

  const data = slimUsage(await fetchUsage(token))
  if (data.error) {
    if (data.error === 'HTTP 429') {
      rateLimited.set(name, Date.now() + RL_BACKOFF)
      // 429 przy wygaslym tokenie NIE jest limitem, tylko martwym kluczem -
      // inaczej uzytkownik szuka winy w liczbie odczytow zamiast w tokenie
      return fallback(expired ? 'token wygasł — zaloguj konto ponownie' : 'limit odczytów — spróbuj za chwilę')
    }
    return fallback(data.error)
  }
  rateLimited.delete(name)
  usageCache.set(name, { at: Date.now(), data })
  saveCache()
  return { ...data, ageMs: 0 }
}

async function accountsState() {
  const cur = currentAccount()
  const out = []
  for (let a of storedAccounts()) {
    a = useLiveCreds(a, cur)
    // martwy token konta nieaktywnego -> wymiana w tle, zeby kafel nie zamarl po dobie
    let dead = null
    if ((a.creds?.claudeAiOauth?.expiresAt ?? 0) < Date.now()) {
      const r = await refreshAccount(a)
      if (r.ok) a = { ...a, creds: r.creds }
      else if (r.dead) dead = r.reason
    }
    const exp = a.creds?.claudeAiOauth?.expiresAt ?? 0
    const active = !!cur?.accountUuid && a.meta?.oauthAccount?.accountUuid === cur.accountUuid
    // Martwe konto NIE dostaje liczb z cache - wygladaloby na zywe, a auto-switch
    // moglby na nie przelaczyc. Blad w usage wyklucza je z pickTarget.
    const u = dead
      ? { error: 'wymaga logowania (' + dead + ')' }
      : await usageFor(a.name, a.creds?.claudeAiOauth?.accessToken, exp < Date.now())
    out.push({
      name: a.name,
      email: a.meta?.oauthAccount?.emailAddress ?? '?',
      plan: a.creds?.claudeAiOauth?.subscriptionType ?? '?',
      active,
      expiresAt: a.creds?.claudeAiOauth?.expiresAt ?? null,
      loginExpiresAt: a.creds?.claudeAiOauth?.refreshTokenExpiresAt ?? null,
      dead: !!dead,
      usage: u,
      // swieza naprawa rozjazdu - plakietka Claudiana pokazuje ja jako ostrzezenie
      ...(active && lastRepair && Date.now() - lastRepair.at < 15 * 60_000 ? { repaired: lastRepair } : {}),
    })
  }
  return out
}

// Model NIE jest wlasnoscia konta - jest jeden dla wszystkich. Ale sa DWA rozne:
// sesje interaktywne biora go z settings.json, a wywolania przez SDK / `claude -p`
// (wtyczki, skrypty, harmonogramy) moga miec wlasny pin. Niewidocznosc tego drugiego
// podbila kiedys zuzycie 54% -> 80%.
// Czytamy model FAKTYCZNIE uzyty, nie zadeklarowany: transkrypt kazdej sesji zapisuje
// `message.model`, a `entrypoint` rozdziela tryby - 'cli' to sesja interaktywna,
// 'sdk-cli' to SDK albo -p. Env cudzego procesu jest z zewnatrz niedostepne.
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

// glowa pliku niesie entrypoint, ogon - ostatni uzyty model; calych plikow (czesto MB)
// nie ma po co wczytywac
function peek(path, { fromEnd = false, bytes = 65_536 } = {}) {
  const size = statSync(path).size
  const start = fromEnd ? Math.max(0, size - bytes) : 0
  const len = Math.min(bytes, size - start)
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, start)
    return buf.toString('utf8')
  } finally { closeSync(fd) }
}

let modelCache = { at: 0, data: null }

function modelInfo() {
  if (Date.now() - modelCache.at < 5 * 60_000 && modelCache.data) return modelCache.data

  const found = { cli: null, 'sdk-cli': null }
  let files = []
  try {
    for (const dir of readdirSync(PROJECTS_DIR)) {
      const full = join(PROJECTS_DIR, dir)
      try {
        if (!statSync(full).isDirectory()) continue
        for (const f of readdirSync(full)) {
          if (!f.endsWith('.jsonl')) continue
          const p = join(full, f)
          try { files.push({ p, mtime: statSync(p).mtimeMs }) } catch {}
        }
      } catch {}
    }
  } catch {}
  files.sort((a, b) => b.mtime - a.mtime)

  for (const { p, mtime } of files.slice(0, 25)) {
    if (found.cli && found['sdk-cli']) break
    let ep = null
    try { ep = peek(p).match(/"entrypoint"\s*:\s*"([^"]+)"/)?.[1] ?? null } catch { continue }
    if (!ep || !(ep in found) || found[ep]) continue
    let model = null
    try {
      const tail = peek(p, { fromEnd: true })
      const all = [...tail.matchAll(/"model"\s*:\s*"([^"]+)"/g)]
      model = all.length ? all[all.length - 1][1] : null
    } catch {}
    if (model) found[ep] = { model, at: mtime }
  }

  // gdy transkryptow brak (swieza maszyna) - deklaracja jako ostatnia deska ratunku
  let fallbackSession = null
  try { fallbackSession = readJson(join(CFG, 'settings.json')).model ?? null } catch {}

  const data = {
    session: found.cli?.model ?? fallbackSession,
    sessionAt: found.cli?.at ?? null,
    job: found['sdk-cli']?.model ?? null,
    jobAt: found['sdk-cli']?.at ?? null,
    // czy to pomiar z transkryptu, czy tylko deklaracja z pliku konfiguracyjnego
    measured: !!(found.cli || found['sdk-cli']),
  }
  modelCache = { at: Date.now(), data }
  return data
}

// --- koszt wznowienia sesji ------------------------------------------------
// Cache promptu po stronie API ma ograniczony czas zycia. Dopoki pracujesz ciagiem,
// kazda tura ODCZYTUJE kontekst z cache (0,1x ceny bazowej). Gdy cache wygasnie,
// caly kontekst trzeba ZAPISAC od nowa (1,25x) - czyli 12,5x drozej za ten sam token,
// zaplacone w JEDNEJ turze, zanim cokolwiek zrobisz.
// Zmierzone 06.09: wznowienie sesji z kontekstem 878k po 6 dniach przerwy zjadlo
// 31% kosztu calego wieczoru w pierwszym zadaniu. Panel ma to pokazac PRZED --resume.
const ZAPIS_MNOZNIK = 1.25   // cennik: zapis do cache
const ODCZYT_MNOZNIK = 0.1   // cennik: odczyt z cache
// Granica "cache raczej jeszcze zyje". Anthropic ma warianty 5 min i 1 h; bierzemy
// dluzszy, zeby nie straszyc na wyrost - i tak pokazujemy dokladny wiek obok.
const CACHE_TTL_MS = 60 * 60_000

function czytelnyProjekt(dir) {
  const czlony = dir.split('-').filter(Boolean)
  return czlony[czlony.length - 1] || dir
}

// Ostatni wpis z `usage` niesie rozmiar kontekstu w chwili konca sesji: suma tego,
// co poszlo z cache i co do niego dopisano. Czytamy OGON pliku - transkrypty
// dochodza do setek MB, a interesuje nas ostatnia tura.
function kontekstSesji(path) {
  let txt
  try { txt = peek(path, { fromEnd: true }) } catch { return null }
  const linie = txt.split('\n')
  // pierwsza linia ogona jest zwykle ucieta w polowie - pomijamy
  for (let i = linie.length - 1; i >= 1; i--) {
    let d
    try { d = JSON.parse(linie[i]) } catch { continue }
    const u = d.message?.usage
    if (!u) continue
    const ctx = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    if (ctx > 0) return ctx
  }
  return null
}

let sesjeCache = { at: 0, data: null }

function sessionsInfo({ limit = 6 } = {}) {
  if (Date.now() - sesjeCache.at < 60_000 && sesjeCache.data) return sesjeCache.data
  const out = []
  let pliki = []
  try {
    for (const proj of readdirSync(PROJECTS_DIR)) {
      let wpisy = []
      try { wpisy = readdirSync(join(PROJECTS_DIR, proj)) } catch { continue }
      for (const n of wpisy) {
        if (!n.endsWith('.jsonl')) continue
        const p = join(PROJECTS_DIR, proj, n)
        try { pliki.push({ proj, id: n.slice(0, -6), path: p, at: statSync(p).mtimeMs }) } catch {}
      }
    }
  } catch { return (sesjeCache = { at: Date.now(), data: [] }).data }

  pliki.sort((a, b) => b.at - a.at)
  // Czytamy ogon tylko tylu plikow, ile pokazujemy - sesji bywa kilkaset.
  // Bierzemy z zapasem, bo czesc odpadnie (puste sesje bez ani jednej tury).
  for (const f of pliki.slice(0, limit * 3)) {
    const ctx = kontekstSesji(f.path)
    if (!ctx) continue
    out.push({
      id: f.id.slice(0, 8),
      projekt: czytelnyProjekt(f.proj),
      kontekst: ctx,
      at: f.at,
      zimny: Date.now() - f.at > CACHE_TTL_MS,
      // ile tokenow w cenie bazowej kosztuje samo wejscie w te sesje
      kosztWznowienia: Math.round(ctx * ZAPIS_MNOZNIK),
      kosztTury: Math.round(ctx * ODCZYT_MNOZNIK),
    })
    if (out.length >= limit) break
  }
  sesjeCache = { at: Date.now(), data: out }
  return out
}

// --- auto-switch -----------------------------------------------------------
// Panel odpytuje limity TYLKO gdy jest widoczny (tak gasilismy 429 z 28.08), wiec przy
// zamknietej zakladce nikt na zuzycie nie patrzy. Auto-switch ma wiec wlasny zegar
// w serwerze. Realny ruch do API reguluje cache (ttlFor), nie ten interwal - tick czesciej
// niz TTL po prostu dostaje te same liczby.
const AUTO_FILE = join(STORE, '.autoswitch.json')
const AUTO_LOG = join(STORE, '.autoswitch.log')
const AUTO_TICK = 60_000
const AUTO_DEFAULTS = {
  enabled: false,     // opt-in: bez auto.json limit po prostu konczy sie na aktywnym koncie
  threshold: 90,        // % ktore uznajemy za "koniec zabawy" na tym koncie
  minGapMs: 5 * 60_000, // anty-oscylacja: nie przelaczaj czesciej niz co 5 min
  resetWaitMs: 15 * 60_000, // okno 5h odnawia sie szybciej niz to - czekamy zamiast przelaczac
}

function autoConfig() {
  try { return { ...AUTO_DEFAULTS, ...readJson(AUTO_FILE) } } catch { return { ...AUTO_DEFAULTS } }
}

function logLine(text) {
  try { appendFileSync(AUTO_LOG, new Date().toISOString() + ' ' + text + '\n') } catch {}
}

// Zapis w jednej linii na konto: nazwa=sesja/tydzien, gwiazdka przy aktywnym.
// To jest odpowiedz na pytanie "co zjadlo limit" - po dobie mamy krzywa zuzycia.
function sampleText(state) {
  return state.map((a) =>
    a.name + '=' + (a.usage?.session?.pct ?? '?') + '/' + (a.usage?.weekly?.pct ?? '?') +
    (a.active ? '*' : '')).join(' ')
}

// Wydzielone z ticka, zeby dalo sie sprawdzic bez sieci (patrz --self-check).
// Zwraca konto, na ktore warto przejsc, albo null z powodem.
function pickTarget(state, threshold, resetWaitMs = 0, now = Date.now()) {
  const active = state.find((a) => a.active)
  if (!active) return { target: null, reason: 'brak aktywnego konta' }
  if (!active.usage || active.usage.error) return { target: null, reason: 'brak odczytu limitu' }

  const pctOf = (a, dflt) => Math.max(a.usage?.session?.pct ?? dflt, a.usage?.weekly?.pct ?? dflt)
  const pct = pctOf(active, 0)
  if (pct < threshold) return { target: null, reason: 'ponizej progu', pct }

  // Tylko okno 5h: gdy odnawia sie za chwile, przelaczenie pali drugie konto i zimny cache
  // za kilka minut czekania (25.09: przelaczyl przy 96%, reset byl za ~10 min).
  // Tydzien ponad progiem - czekanie nie pomoze, przelaczamy jak dotad.
  const resetMs = Date.parse(active.usage.session?.resetsAt ?? '')
  const weekPct = active.usage.weekly?.pct ?? 0
  if (weekPct < threshold && resetMs - now < resetWaitMs) {
    return { target: null, reason: 'reset za chwile', pct, resetInMs: resetMs - now }
  }

  // Kandydat musi sam byc pod progiem - przejscie na konto rowniez wyczerpane
  // tylko pali drugi token i nic nie daje.
  const cand = state
    .filter((a) => !a.active && a.usage && !a.usage.error)
    .map((a) => ({ a, pct: pctOf(a, 100) }))
    .filter((c) => c.pct < threshold)
    .sort((x, y) => x.pct - y.pct)[0]

  if (!cand) return { target: null, reason: 'brak wolnego konta', pct }
  return { target: cand.a, reason: 'przelacz', pct, targetPct: cand.pct }
}

let autoLastSwitch = 0
let autoLastSample = ''
// Komunikaty tez deduplikujemy. Gdy WSZYSTKIE konta stoja na progu, stan nie zmienia sie
// godzinami - bez tego log dostawal identyczna linie co minute (36 sztuk 06.09 wieczorem)
// i krzywa zuzycia tonela w powtorzeniach.
let autoLastNote = ''
let autoTicking = false
// Kiedy tick zawisnie mimo limitu czasu (cokolwiek innego w srodku), nastepny go przejmuje.
// To jedyna warstwa, ktora naprawia sie sama NIEZALEZNIE od przyczyny zawieszenia.
let autoTickingSince = 0
const TICK_WATCHDOG_MS = 5 * 60_000

async function autoSwitchTick() {
  if (autoTicking) {                // tick wolniejszy niz interwal nie ma sie nakladac
    if (Date.now() - autoTickingSince < TICK_WATCHDOG_MS) return
    logLine('ZAWIESZONY tick (' + Math.round((Date.now() - autoTickingSince) / 1000) + 's) - wznawiam')
  }
  autoTicking = true
  autoTickingSince = Date.now()
  try {
    const cfg = autoConfig()
    if (!cfg.enabled) return
    const state = await accountsState()

    // Rozjazd naprawiamy od razu i konczymy tick - stan zebrany przed naprawa przypisal
    // zuzycie zlemu kontu, wiec decyzja o przelaczeniu czeka na nastepny tick (60 s).
    if (repairIdentity('auto')) return

    const s = sampleText(state)
    if (s !== autoLastSample) { logLine(s); autoLastSample = s }

    const { target, reason, pct, targetPct } = pickTarget(state, cfg.threshold, cfg.resetWaitMs)
    if (!target) {
      if (reason === 'brak wolnego konta' || reason === 'reset za chwile') {
        const note = 'PROG ' + pct + '% ale ' + reason
        if (note !== autoLastNote) { logLine(note); autoLastNote = note }
      }
      return
    }
    if (Date.now() - autoLastSwitch < cfg.minGapMs) return

    const active = state.find((a) => a.active)
    // yes:true swiadomie: prog oznacza, ze na tym koncie i tak nie ma juz czym pracowac,
    // wiec nie ma czego chronic pytaniem o zywa sesje.
    await doSwitch(target.name, { yes: true, source: 'auto' })
    autoLastSwitch = Date.now()
    autoLastNote = ''
    logLine('PRZELACZONO ' + active.name + ' (' + pct + '%) -> ' + target.name + ' (' + targetPct + '%)')
  } catch (e) {
    logLine('BLAD ticka: ' + String(e.message ?? e))
  } finally {
    autoTicking = false
  }
}

// Po `GET /api/health` wtyczka odroznia swoj panel od cudzego na tym samym porcie.
// PANEL_VERSION podbijamy przy kazdej zmianie serwera - starsza wersja zostaje zatrzymana.
const PANEL_APP_ID = 'claudian-plus-accounts'
const PANEL_VERSION = 1
const OBSIDIAN_ORIGIN = 'app://obsidian.md'
const ODMOWA = JSON.stringify({ error: 'dostęp tylko z panelu kont albo z Obsidiana' })

// Serwer slucha na 127.0.0.1, ale przegladarka wpusci do niego KAZDA otwarta strone
// (fetch bez preflightu, DNS rebinding). /api/accounts wydaje maile, /api/switch podmienia
// tokeny - wiec Origin i Host sprawdzamy przed routingiem, dla kazdej sciezki.
// Brak Origin = CLI/curl; Host musi byc nasz, bo przy DNS rebinding Origin to adres atakujacego
// rozwiazany na 127.0.0.1, a Host niesie jego nazwe.
function originAllowed(origin, host, port) {
  const local = ['127.0.0.1:' + port, 'localhost:' + port]
  if (!local.includes(host)) return false
  if (origin === undefined) return true
  return origin === OBSIDIAN_ORIGIN || local.some((h) => origin === 'http://' + h)
}

async function serve(portArg) {
  const port = Number(portArg) || 7788
  loadCache()
  for (const n of sweepAbandoned()) logLine('SPRZATNIETE porzucone logowanie z panelu: ' + n)
  const auto = !process.argv.includes('--no-auto')
  const { createServer } = await import('node:http')
  const panel = join(import.meta.dirname, 'panel.html')

  const send = (res, code, body, type = 'application/json') =>
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }).end(body)

  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin
      if (!originAllowed(origin, req.headers.host, port)) return send(res, 403, ODMOWA)
      // wtyczka Obsidiana jest cross-origin - bez tego jej fetch zostanie uciety; nigdy '*'
      if (origin === OBSIDIAN_ORIGIN) res.setHeader('Access-Control-Allow-Origin', OBSIDIAN_ORIGIN)
      // sama sciezka - z query stringiem porownanie do '/' nie trafia
      const path = new URL(req.url, 'http://127.0.0.1').pathname
      if (path === '/' || path === '/index.html') {
        return send(res, 200, readFileSync(panel, 'utf8'), 'text/html')
      }
      if (path === '/api/health') {
        return send(res, 200, JSON.stringify({ app: PANEL_APP_ID, version: PANEL_VERSION }))
      }
      // zatrzymuje panel tylko wtyczka - inaczej kazda karta panelu moglaby go wylaczyc
      if (path === '/api/shutdown' && req.method === 'POST') {
        if (origin !== OBSIDIAN_ORIGIN) return send(res, 403, ODMOWA)
        // wyjscie dopiero po wyslaniu odpowiedzi - inaczej wtyczka dostaje zerwane polaczenie
        res.on('finish', () => { server.close(); process.exit(0) })
        return send(res, 200, JSON.stringify({ ok: true }))
      }
      if (path === '/api/accounts') {
        return send(res, 200, JSON.stringify(await accountsState()))
      }
      if (path === '/api/switch' && req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const { name, source } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        // tylko znane zrodla - tekst trafia do logu
        await doSwitch(name, { yes: true, source: source === 'claudian' ? 'claudian' : 'panel' })
        return send(res, 200, JSON.stringify({ ok: true, name }))
      }
      // relogin w dwoch krokach: link do strony logowania, potem kod z tej strony
      if ((path === '/api/relogin' || path === '/api/relogin-code') && req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const { name, code } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const wynik = path === '/api/relogin' ? await reloginStart(name) : await reloginFinish(name, code)
        return send(res, 200, JSON.stringify({ ok: true, ...wynik }))
      }
      // dodawanie kont: biezace z ~/.claude albo nowe przez logowanie do katalogu w magazynie
      const ADD = ['/api/add-current', '/api/add-new', '/api/add-new-code', '/api/add-new-cancel']
      if (ADD.includes(path) && req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const { name, code } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (path === '/api/add-current') {
          const r = saveCurrent(name || undefined)
          logLine('ZAPISANO z panelu ' + r.name + ' (' + r.email + ')')
          return send(res, 200, JSON.stringify({ ok: true, name: r.name, email: r.email }))
        }
        checkName(name)
        if (path === '/api/add-new') {
          const { url } = await newLoginStart(name)
          return send(res, 200, JSON.stringify({ ok: true, url }))
        }
        if (path === '/api/add-new-cancel') { loginCancel(name); return send(res, 200, JSON.stringify({ ok: true })) }
        const { email } = await reloginFinish(name, code)
        return send(res, 200, JSON.stringify({ ok: true, email }))
      }
      // GET zwraca stan, POST go zmienia. tickActive mowi, czy zegar auto w ogole
      // chodzi w tym procesie - przy `serve --no-auto` przelacznik nic nie da.
      if (path === '/api/auto') {
        if (req.method === 'POST') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const { enabled } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (typeof enabled !== 'boolean') {
            return send(res, 400, JSON.stringify({ error: 'podaj enabled: true albo false' }))
          }
          mkdirSync(STORE, { recursive: true })
          writeJson(AUTO_FILE, { ...autoConfig(), enabled })
          logLine('auto-switch ' + (enabled ? 'WLACZONY' : 'WYLACZONY') + ' z panelu')
        }
        const c = autoConfig()
        return send(res, 200, JSON.stringify({ enabled: c.enabled, threshold: c.threshold, tickActive: auto }))
      }
      if (path === '/api/sessions') {
        return send(res, 200, JSON.stringify(sessionsInfo()))
      }
      if (path === '/api/running') {
        return send(res, 200, JSON.stringify({ count: claudeProcessCount(), models: modelInfo() }))
      }
      send(res, 404, JSON.stringify({ error: 'nie ma takiej sciezki' }))
    } catch (e) {
      send(res, e.status ?? 500, JSON.stringify({ error: String(e.message ?? e) }))
    }
  })

  // blad gniazda przychodzi jako zdarzenie, try/catch go nie zlapie
  server.on('error', (e) => die('serwer: ' + e.message))
  server.listen(port, '127.0.0.1', () => {
    console.log('panel: http://127.0.0.1:' + port)
    if (auto) {
      const c = autoConfig()
      console.log('auto:  ' + (c.enabled ? 'prog ' + c.threshold + '%, log ' + AUTO_LOG : 'wylaczony (wlacz: {\"enabled\":true} w ' + AUTO_FILE + ')'))
      autoSwitchTick()
      setInterval(autoSwitchTick, AUTO_TICK)
    } else console.log('auto:  wylaczony (--no-auto)')
    console.log('stop:  Ctrl+C')
  })
}

async function selfCheck() {
  const dir = join(tmpdir(), 'cc-accounts-selfcheck-' + process.pid)
  // process.exit pomija finally - sprzatamy na zdarzeniu exit
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} })
  mkdirSync(dir, { recursive: true })
  const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1) } }

  // zapis atomowy: plik istnieje, tmp znika, tresc sie zgadza
  const p = join(dir, 'x.json')
  writeJson(p, { a: 1, zażółć: 'gęślą jaźń' })
  assert(existsSync(p), 'writeJson nie utworzyl pliku')
  assert(!existsSync(p + '.tmp'), 'writeJson zostawil plik .tmp')
  assert(readJson(p).zażółć === 'gęślą jaźń', 'writeJson zgubil polskie znaki')

  // nadpisanie nie gubi danych
  writeJson(p, { a: 2 })
  assert(readJson(p).a === 2, 'writeJson nie nadpisal')

  // tokenState rozroznia wazny od wygaslego
  assert(tokenState({ claudeAiOauth: { expiresAt: Date.now() + 6e4 } }).startsWith('wazny'), 'tokenState: wazny')
  assert(tokenState({ claudeAiOauth: { expiresAt: Date.now() - 6e4 } }).startsWith('WYGASL'), 'tokenState: wygasly')
  assert(tokenState({}) === 'brak', 'tokenState: brak')

  // slimUsage przepuszcza blad i tnie odpowiedz do dwoch pol
  assert(slimUsage({ error: 'HTTP 401' }).error === 'HTTP 401', 'slimUsage: blad')
  const s = slimUsage({ five_hour: { utilization: 4, resets_at: 'X' }, seven_day: { utilization: 5, resets_at: 'Y' } })
  assert(s.session.pct === 4 && s.weekly.resetsAt === 'Y', 'slimUsage: mapowanie')

  // bramka Origin/Host: obca strona w przegladarce nie moze czytac maili ani przelaczac kont
  {
    const P = 7788
    const ok = (origin, host = '127.0.0.1:' + P) => originAllowed(origin, host, P)
    assert(ok(undefined), 'originAllowed: odrzucil brak Origin (CLI, curl)')
    assert(ok(undefined, 'localhost:' + P), 'originAllowed: odrzucil Host localhost')
    assert(ok(OBSIDIAN_ORIGIN), 'originAllowed: odrzucil Obsidiana')
    assert(ok('http://127.0.0.1:' + P), 'originAllowed: odrzucil panel na 127.0.0.1')
    assert(ok('http://localhost:' + P), 'originAllowed: odrzucil panel na localhost')
    assert(!ok('https://example.com'), 'originAllowed: wpuscil obca strone')
    assert(!ok('null'), 'originAllowed: wpuscil Origin null (sandbox, file://)')
    assert(!ok('http://127.0.0.1:' + (P + 1)), 'originAllowed: wpuscil inny port na localhoscie')
    assert(!ok('http://127.0.0.1:' + P + '.evil.example'), 'originAllowed: wpuscil doklejona domene')
    assert(!ok(undefined, 'evil.example:' + P), 'originAllowed: wpuscil obcy Host (DNS rebinding)')
    assert(!originAllowed(undefined, undefined, P), 'originAllowed: wpuscil brak Host')
    assert(!ok(OBSIDIAN_ORIGIN, 'evil.example:' + P), 'originAllowed: obcy Host przeszedl z Originem Obsidiana')
  }

  // --- auto-switch: wybor kandydata i TTL cache ---
  // Kazda galaz pickTarget ma tu przypadek - to jedyne miejsce, gdzie logika
  // decydujaca o podmianie tokenow jest sprawdzana bez ruszania zywych plikow.
  const u = (s, w) => ({ usage: { session: { pct: s }, weekly: { pct: w } } })
  const konto = (name, active, s, w) => ({ name, active, ...u(s, w) })

  // ponizej progu - nie ruszamy
  assert(pickTarget([konto('a', true, 50, 10), konto('b', false, 5, 5)], 90).target === null,
    'pickTarget: przelaczyl ponizej progu')
  // powyzej progu - idziemy na konto z najwiekszym zapasem
  {
    const r = pickTarget([konto('a', true, 95, 10), konto('b', false, 40, 5), konto('c', false, 8, 5)], 90)
    assert(r.target?.name === 'c', 'pickTarget: wybral zle konto (' + r.target?.name + ')')
    assert(r.pct === 95 && r.targetPct === 8, 'pickTarget: zle liczby w wyniku')
  }
  // limit TYGODNIOWY tez ma przelaczac, nie tylko 5h
  assert(pickTarget([konto('a', true, 10, 96), konto('b', false, 20, 20)], 90).target?.name === 'b',
    'pickTarget: zignorowal limit tygodniowy')
  // wszystkie konta spalone - nie ma dokad isc
  assert(pickTarget([konto('a', true, 95, 10), konto('b', false, 99, 10)], 90).target === null,
    'pickTarget: przeszedl na konto rowniez wyczerpane')
  // konto bez odczytu limitu nie jest kandydatem (inaczej skoczylby w ciemno)
  assert(pickTarget([konto('a', true, 95, 10), { name: 'b', active: false, usage: { error: 'x' } }], 90).target === null,
    'pickTarget: wybral konto bez odczytu')
  // brak odczytu na AKTYWNYM koncie = nie wiemy nic, nie ruszamy
  assert(pickTarget([{ name: 'a', active: true, usage: { error: 'x' } }, konto('b', false, 5, 5)], 90).target === null,
    'pickTarget: przelaczyl mimo braku odczytu aktywnego')
  // okno 5h odnawia sie za chwile - czekamy; tydzien ponad progiem albo reset daleko - przelaczamy
  {
    const T = Date.parse('2026-09-25T16:49:34Z')
    const zResetem = (s, w, reset) => ({ name: 'a', active: true,
      usage: { session: { pct: s, resetsAt: new Date(T + reset).toISOString() }, weekly: { pct: w } } })
    const wolne = konto('b', false, 10, 10)
    assert(pickTarget([zResetem(96, 40, 6 * 60_000), wolne], 90, 10 * 60_000, T).reason === 'reset za chwile',
      'pickTarget: przelaczyl mimo resetu za 6 min')
    assert(pickTarget([zResetem(96, 40, 30 * 60_000), wolne], 90, 10 * 60_000, T).target?.name === 'b',
      'pickTarget: czeka na reset odlegly o 30 min')
    assert(pickTarget([zResetem(96, 95, 6 * 60_000), wolne], 90, 10 * 60_000, T).target?.name === 'b',
      'pickTarget: czeka na reset 5h, choc tydzien spalony')
  }

  // TTL: im blizej limitu, tym swiezsze dane - i nigdy ponizej 60 s (429 z 28.08)
  assert(ttlFor(u(10, 10).usage) === 5 * 60_000, 'ttlFor: zly TTL przy niskim zuzyciu')
  assert(ttlFor(u(88, 10).usage) === 90_000, 'ttlFor: zly TTL przy wysokim zuzyciu')
  assert(ttlFor(u(10, 88).usage) === 90_000, 'ttlFor: zignorowal limit tygodniowy')
  assert(ttlFor(u(10, 10).usage) > ttlFor(u(75, 10).usage), 'ttlFor: nie skraca sie przy wzroscie')
  assert(ttlFor(u(88, 10).usage) >= 60_000, 'ttlFor: pytamy czesciej niz co 60 s - ryzyko 429')
  assert(ttlFor({}) === 5 * 60_000, 'ttlFor: wywrocil sie na pustych danych')

  // martwy token: bez sieci i bez kopii w .backup (22.09 dalo 309 prob co minute)
  {
    const fake = (rt, rtExp) => ({ name: '__selfcheck', dir, creds: { claudeAiOauth: { refreshToken: rt, refreshTokenExpiresAt: rtExp } } })
    const ile = () => { try { return readdirSync(join(STORE, '.backup')).length } catch { return 0 } }
    const przed = ile()
    const r1 = await refreshAccount(fake('x', Date.now() - 1))
    assert(!r1.ok && r1.dead, 'refreshAccount: wygasle logowanie nie oznaczone jako martwe')
    deadRefresh.set('__selfcheck', { rt: 'x', reason: 'HTTP 400 invalid_grant' })
    const r2 = await refreshAccount(fake('x', Date.now() + 864e5))
    assert(!r2.ok && r2.dead && r2.reason.includes('invalid_grant'), 'refreshAccount: ponowil znany martwy token')
    assert(ile() === przed, 'refreshAccount: martwy token zostawil kopie w .backup')
    deadRefresh.delete('__selfcheck')
  }

  // --- dodawanie kont: nazwa idzie do sciezki, magazyn w katalogu tymczasowym ---
  {
    const zlaNazwa = (n) => { try { checkName(n); return false } catch (e) { return e.status === 400 && e.message.startsWith('nazwa może') } }
    assert(checkName('praca') === 'praca', 'checkName: odrzucil "praca"')
    for (const n of ['../x', 'a/b', 'a\\b', '', 'x'.repeat(41), '..', '.', '.backup', undefined, 7]) {
      assert(zlaNazwa(n), 'checkName: przepuscil ' + JSON.stringify(n))
    }

    const S = join(dir, 'store')
    const tok = (rt) => ({ claudeAiOauth: { accessToken: 'a', ...(rt ? { refreshToken: rt } : {}) } })
    const U1 = { accountUuid: 'u1', emailAddress: 'jeden@x' }
    const U2 = { accountUuid: 'u2', emailAddress: 'dwa@x' }
    const konto = (name, acct, creds = tok('r')) => {
      const d = join(S, name)
      mkdirSync(d, { recursive: true })
      writeJson(join(d, '.credentials.json'), creds)
      writeJson(join(d, '.claude.json'), { oauthAccount: acct })
      return d
    }
    const blad = (fn) => { try { fn(); return '' } catch (e) { return e.message } }
    konto('stare', U1)
    writeJson(join(S, 'stare', 'meta.json'), { name: 'stare', oauthAccount: U1 })

    // newLoginVerify: nowy uuid -> meta.json
    const d1 = konto('nowe', U2)
    assert(newLoginVerify({ name: 'nowe', dir: d1, store: S }).email === 'dwa@x', 'newLoginVerify: zly email')
    assert(readJson(join(d1, 'meta.json')).oauthAccount.accountUuid === 'u2', 'newLoginVerify: brak meta.json')
    // uuid jak istniejace konto -> blad i katalog skasowany
    const d2 = konto('dubel', U1)
    assert(blad(() => newLoginVerify({ name: 'dubel', dir: d2, store: S })).includes('już jest zapisane jako „stare”'),
      'newLoginVerify: przepuscil duplikat uuid')
    assert(!existsSync(d2), 'newLoginVerify: zostawil katalog duplikatu')
    // brak refreshToken -> blad i katalog skasowany
    const d3 = konto('bez', { accountUuid: 'u3' }, tok(null))
    assert(blad(() => newLoginVerify({ name: 'bez', dir: d3, store: S })) === 'logowanie nie zapisało tokenu',
      'newLoginVerify: przepuscil brak tokenu')
    assert(!existsSync(d3), 'newLoginVerify: zostawil katalog bez tokenu')
    // removeNewDir nie rusza katalogu z meta.json ani niczego spoza magazynu
    removeNewDir(join(S, 'stare'), S)
    assert(existsSync(join(S, 'stare')), 'removeNewDir: skasowal konto z meta.json')
    removeNewDir(S, S)
    assert(existsSync(S), 'removeNewDir: skasowal sam magazyn')
    // porzucone logowanie z panelu (znacznik, bez meta.json) -> sprzatniete przy starcie;
    // katalog bez znacznika (terminalowe add-new) i konto z meta.json zostaja
    for (const [n, znacznik, meta] of [['porzucone', true, false], ['terminal', false, false], ['gotowe', true, true]]) {
      mkdirSync(join(S, n))
      if (znacznik) writeFileSync(join(S, n, PANEL_LOGIN_MARK), 'x')
      if (meta) writeJson(join(S, n, 'meta.json'), { name: n })
    }
    assert(sweepAbandoned(S).join() === 'porzucone', 'sweepAbandoned: zla lista')
    assert(!existsSync(join(S, 'porzucone')) && existsSync(join(S, 'terminal')) && existsSync(join(S, 'gotowe')),
      'sweepAbandoned: skasowal nie to, co trzeba')
    // pusty katalog (panel padl w trakcie logowania) nie udaje konta
    mkdirSync(join(S, 'pusty'))
    assert(!storedAccounts(S).some((a) => a.name === 'pusty'), 'storedAccounts: pusty katalog jako konto')

    // saveCurrent: niezalogowany, uuid pod inna nazwa, cudze konto pod ta nazwa, odswiezenie
    assert(blad(() => saveCurrent('x', { creds: null, acct: U1, store: S })).includes('nie jest zalogowany'),
      'saveCurrent: brak komunikatu o braku logowania')
    assert(blad(() => saveCurrent('inna', { creds: tok('r'), acct: U1, store: S })).includes('już jest zapisane jako „stare”'),
      'saveCurrent: zapisal uuid drugi raz pod inna nazwa')
    assert(!existsSync(join(S, 'inna')), 'saveCurrent: duplikat zostawil katalog')
    assert(blad(() => saveCurrent('nowe', { creds: tok('r'), acct: { accountUuid: 'u9' }, store: S })).includes('już jest w magazynie'),
      'saveCurrent: nadpisal tokeny innego konta pod ta nazwa')
    assert(blad(() => saveCurrent('../x', { creds: tok('r'), acct: { accountUuid: 'u9' }, store: S })).startsWith('nazwa może'),
      'saveCurrent: przepuscil zla nazwe')
    assert(saveCurrent('stare', { creds: tok('r2'), acct: U1, store: S }).email === 'jeden@x', 'saveCurrent: odswiezenie kopii')
    assert(readJson(join(S, 'stare', '.credentials.json')).claudeAiOauth.refreshToken === 'r2', 'saveCurrent: kopia nieodswiezona')
    // nazwa z maila tez przechodzi walidacje
    assert(saveCurrent(undefined, { creds: tok('r'), acct: { accountUuid: 'u5', emailAddress: 'jan.k+x@y' }, store: S }).name === 'jan.k_x',
      'saveCurrent: zla nazwa z maila')
  }

  console.log('self-check OK')
}

// --- wejscie ---------------------------------------------------------------

const argv = process.argv.slice(2)
const yes = argv.includes('--yes')
const [cmd, arg] = argv.filter((a) => a !== '--yes' && a !== '--no-auto')
switch (cmd) {
  case 'list': list(); ostrzezORozjezdzie(); break
  case 'add': add(arg); break
  case 'add-new': addNew(arg); break
  case 'relogin': reloginCmd(arg); break
  case 'refresh': await refreshCmd(arg); break
  case 'oauth-info': oauthInfo(); break
  case 'whoami': whoami(); ostrzezORozjezdzie(); break
  case 'usage': await usage(arg); break
  case 'switch':
    try { await doSwitch(arg, { yes }) } catch (e) { die(e.message) }
    break
  case 'repair': doRepair(); break
  case 'serve': await serve(arg); break
  case '--self-check': await selfCheck(); break
  default:
    console.log('uzycie: node accounts.mjs <komenda>')
    console.log('  list                    konta w magazynie (* = aktywne)')
    console.log('  whoami                  kto jest teraz zalogowany')
    console.log('  add [nazwa]             zapisz biezace konto do magazynu')
    console.log('  add-new <nazwa>         dodaj KOLEJNE konto (wypisze co wkleic)')
    console.log('  relogin <nazwa>         zaloguj ponownie konto z magazynu (~/.claude nietkniete)')
    console.log('  usage [nazwa|--all]     stan limitow')
    console.log('  refresh <nazwa>         odswiez wygasly token (bez ponownego logowania)')
    console.log('  oauth-info              co narzedzie odczytalo z binarki claude')
    console.log('  switch <nazwa> [--yes]  przelacz konto (--yes pomija pytanie o zywe sesje)')
    console.log('  repair                  uzgodnij .claude.json z kontem zywego tokenu')
    console.log('  serve [port] [--no-auto] panel HTML na 127.0.0.1 (domyslnie 7788)')
    console.log('                          auto-switch wlaczony; prog i wylacznik: .autoswitch.json')
    console.log('  --self-check            test logiki')
    console.log('magazyn: ' + STORE)
}
