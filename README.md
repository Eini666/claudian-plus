# Claudian Plus

**English** | [Polski](README.pl.md)

A fork of **[Claudian](https://github.com/YishenTu/claudian)** by Yishen Tu (MIT license) — a
Claude Code agent in the Obsidian sidebar, with your vault as its working directory.

The core, the architecture and most of the code are the original author's work. Claudian Plus adds
a layer that helps in day-to-day work with Claude Code. Original plugin description:
[`README-upstream.md`](README-upstream.md). Base: Claudian `2.2.6`.

## What it adds

- **Full Claude Code preset** — the plugin loads `CLAUDE.md` (global and project), rules from
  `.claude/rules/` and your selected output style, just like the CLI. The original passes its own
  prompt, which replaces all of that.
- **Polish interface** (English stays available).
- **Plan limits 5h / 7d and context usage** in the bar below the message field.
- **Steer, `/btw`, `/goal`** — interject during a turn, ask a side question without derailing the
  conversation, set a goal for the conversation.
- **`plus-ui` tiles and charts** — code blocks the agent can render as interface elements.
- **Local pages in the built-in browser**, reloaded when the file changes.
- **Conversation archiving.**
- **Projects** — group conversations into projects in the wide session list: + next to a project starts a
  conversation in it, and you can drag conversations between projects, Sessions and Pinned.
- **Reading other sessions** — the agent can list your other conversations and read them (`list_sessions`,
  `read_session`), and `@` in the composer lets you point it at a specific conversation.
- **Status avatar** — see whether the agent is working, waiting for you or done; optionally a
  desktop window and a Windows taskbar signal while Obsidian is in the background.
- **Telegram and voice messages** — message (or talk to) the agent from your phone; when you are away, it
  sends you voice messages after each stage of work.
- **"Extras" section in settings** — assistant name, avatar, Telegram bridge, account switcher.

## Installation (manual)

The plugin is not in the Obsidian community store.

```bash
git clone https://github.com/Eini666/claudian-plus.git
cd claudian-plus
npm install
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/claudian-plus/`,
then in Obsidian: *Settings → Community plugins* → enable **Claudian Plus**.

**Do not enable it together with Claudian from the store in the same vault.** Both plugins register
the same view type and keep settings and conversations in the same `.claudian/` folder in the vault.
Disable one before enabling the other — conversations and settings carry over, because they live
outside the plugin folder.

## Telegram and voice messages

### Step-by-step setup

1. In Telegram, message **@BotFather**, send `/newbot`, give it a name and copy the token.
2. In Obsidian: *Settings → Claudian Plus → Extras → Telegram bridge*. Enable the bridge and choose
   the **"Built-in bot"** mode.
3. Paste the token into **"Bot token"**.
4. Click **"Connect phone"** and send your bot the 6-digit code shown in settings within 120 s.
5. **"Voice tools"** — click **"Install"** for each missing tool: Piper (~21 MB), the voice selected
   in "Voice" (~60 MB), ffmpeg (~110 MB).
6. **"Send a test voice message"** — a voice message should arrive on your phone.
7. **"Speech recognition"** (optional, to talk to the agent with voice messages) — pick a model and
   click **"Install"**: whisper.cpp (~8 MB) and the model — `large-v3-turbo` accurate (~550 MB) or
   `small` fast (~180 MB). Everything runs locally; recordings never leave your computer.

### Day to day

The bot commands and replies are currently in **Polish**:

- **„wychodzę”** ("I'm leaving") — away mode: messages from your phone go to the active tab, and the
  agent sends voice messages after each stage and in reply to your messages.
- **„wróciłem”** ("I'm back") — home mode: the agent writes on screen only, the bot does not accept
  commands.
- **„nowy temat: …”** ("new topic: …") — opens a new tab (a new conversation) and sends the rest of
  the message there.
- **Your voice messages** — with speech recognition installed you can talk instead of typing. The
  bot sends back what it heard ("Przekazane do …: „…”"), so you see right away what it understood.
  The „wychodzę” and „wróciłem” commands work by voice too.
- Messages sent while Obsidian was closed for more than 5 minutes are not executed — the bot asks
  you to send them again.
- The bot only works while Obsidian is open.
- One bot = one program. Do not connect the same bot to two programs at once — they will steal each
  other's messages.

### Privacy

- The token and chat id live in `~/.claudian-plus/telegram.json`, **outside the vault** — they will
  not end up in sync or in your vault repository. Voice tools: `~/.claudian-plus/bin`.
- The bot answers only the paired private chat; messages from other chats are ignored.
- Claude leaves voice message texts in the bridge folder (default `~/.claudian-plus/most`).

### What the installer downloads

Versions are pinned, and each file is accepted only if its size and SHA-256 match.

| Tool | Source | License |
|---|---|---|
| Piper `2023.11.14-2` | GitHub `rhasspy/piper` (release) | MIT; bundled espeak-ng — GPL-3.0 |
| Voices `pl_PL-gosia`, `darkman`, `mc_speech` (medium) | Hugging Face `rhasspy/piper-voices` | CC0 datasets; models fine-tuned from the English `lessac` voice — check the base model license in `MODEL_CARD` |
| ffmpeg `9.0.2` essentials | GitHub `GyanD/codexffmpeg` (gyan.dev build) | GPL-3.0 |
| whisper.cpp `v1.9.2` (`whisper-bin-x64.zip`, ~8 MB) | GitHub `ggml-org/whisper.cpp` (release) | MIT |
| Whisper models `large-v3-turbo` q5_0 (~550 MB), `small` q5_1 (~180 MB) | Hugging Face `ggerganov/whisper.cpp` | MIT (OpenAI Whisper weights) |

Recognition speed (measured on a Ryzen 7 5800X, 16 threads): an 8 s voice message → `large-v3-turbo`
about 8 s, `small` about 2.5 s, both flawless in Polish. On a slower CPU it is proportionally slower.

**Manual installation**, if the download fails: get the same files and arrange them like this:

```
~/.claudian-plus/bin/
  piper/                         ← contents of the piper/ folder from piper_windows_amd64.zip (with piper.exe)
  ffmpeg/ffmpeg.exe              ← from the bin/ folder of the ffmpeg archive
  glosy/pl_PL-gosia-medium/      ← pl_PL-gosia-medium.onnx and pl_PL-gosia-medium.onnx.json
  whisper/                       ← contents of the Release/ folder from whisper-bin-x64.zip (with whisper-cli.exe)
  modele-mowy/large-v3-turbo/ggml-large-v3-turbo-q5_0.bin
  modele-mowy/small/ggml-small-q5_1.bin
```

### "External program" mode

For people who already have their own assistant with a bot. You point to a bridge folder, and the
program writes files there:

- `poza-domem` — the away-mode flag (the button in the plugin bar toggles it too),
- `wiadomosc.txt` — a message from the phone; the plugin picks it up and inserts it into the
  active tab.

The built-in bot also uses `czeka` in that folder (timestamp of the last voice message — the next
message is a reply to it) and the `glosowka-<id>.txt` → `glosowka-<id>.wynik` outbox (text from Claude
→ send result). In external mode the plugin does not handle that outbox and does not add the voice
instructions — if you want them, your program can adopt the same layout.

### Limitations

- Voice (synthesis and speech recognition) works on Windows x64 only.
- Without speech recognition installed, the bot replies to a voice message with "write it as text".
- Voices and bot texts are Polish.

## Claude account switcher

For people with several Claude accounts (e.g. personal and work). Switch accounts with one click in
the bar, without `claude auth logout` / `login`, and see the 5h and 7d usage of every account — also
the ones you are not on right now. Off by default. The limits bar works without it.

### Setup

1. *Settings → Claudian Plus → Extras* → enable **"Account switcher"**.
2. Leave **"Start the accounts panel"** on. The plugin writes a local accounts panel to
   `~/.claudian-plus/accounts/` and starts it with Obsidian (at `http://127.0.0.1:7788`).
   The panel needs **Node.js 20.11 or newer** on PATH; without it "Panel status" shows "Node.js not found".
3. **"Open panel"** → **"Zapisz bieżące konto"** ("Save current account") — the account Claude Code
   is logged in to right now.
4. **"Dodaj konto"** ("Add account") for each additional one: enter a name (e.g. `work`), open the
   link **in a private browser window** (Ctrl+Shift+N), log in to that account, copy the code from the
   page and paste it into the panel. A normal window would approve the account already open on claude.ai.
5. Reopen the chat tab — an account badge with a switch menu appears next to the limits bar.

**Do not use `claude auth logout` to add accounts** — logging out can invalidate the token of the
account the panel has just saved.

### Day to day

- **Switching** — the badge in the bar or the "przełącz" button in the panel. The menu shows each
  account's usage. In a long conversation it also shows the switch cost: the prompt cache is separate
  per account, so the new account writes the whole context again (about 12.5× the price of a cache
  read). With a very large context, starting a new conversation is cheaper.
- **Auto-switch** (enabled in the panel, off by default) — when the active account goes above 90% of a
  limit, the panel switches to the least used account below the threshold. It waits instead when the
  5h window resets within minutes. Change the threshold in `~/.claude/accounts/.autoswitch.json`.
- **"zaloguj ponownie"** ("log in again") — a login lives about 4 weeks from logging in. When it
  expires, the panel shows the button and walks you through the same private window + code.
- The panel runs while Obsidian runs. Want it always on, also for the plain CLI? Turn off
  "Start the accounts panel" and add a logon task (Windows, PowerShell):

```powershell
$dir = "$env:USERPROFILE\.claudian-plus\accounts"
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' `
  -Argument 'accounts.mjs serve 7788' -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName 'Claude Code accounts' -Action $action -Trigger $trigger
```

### Security

- `~/.claude/accounts/` holds **plain-text login tokens** of every account. Treat it like a password:
  keep it out of repositories, sync and unencrypted cloud backups.
- The panel listens on `127.0.0.1` only and rejects requests from pages other than the panel itself
  and Obsidian. The browser gets e-mail addresses and percentages; tokens never leave the panel.
- Before every switch the panel backs up the login files to `~/.claude/accounts/.backup/`.
- This is a tool for **your own** accounts that you pay for, not for getting around limits.

### Limitations

- Windows: tested. Linux: should work, untested. **macOS: does not work** — Claude Code keeps the
  login in the Keychain there, not in a file.
- The panel UI is in Polish only.
- An expired token returns `429`, not `401` — if the panel says the token expired, log the account in again.
- The usage endpoint is strictly rate-limited; the panel caches readings and only asks while it is visible.

## Requirements

- Obsidian desktop (Windows, macOS, Linux), version 1.13.0 or newer
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in
- Node 24 to build the plugin
- Voice messages: Windows x64
- Account switcher: Node.js 20.11+ on PATH, Windows (Linux untested, macOS no)

Claudian Plus additions are tested on Windows only; voice features require Windows x64.

## License

MIT — like the original. See [`LICENSE`](LICENSE). Third-party code in `src/vendor/` has its own
licenses in its folders. Voice tools are not part of the package — the installer downloads them,
each under its own license (table above).
