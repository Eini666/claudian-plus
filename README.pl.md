# Claudian Plus

[English](README.md) | **Polski**

Fork wtyczki **[Claudian](https://github.com/YishenTu/claudian)** autorstwa Yishena Tu (licencja MIT)
— agent Claude Code w panelu bocznym Obsidiana, a vault jest jego katalogiem roboczym.

Rdzeń, architektura i większość kodu to praca autora oryginału. Claudian Plus dokłada warstwę,
która przydaje się przy codziennej pracy z Claude Code po polsku. Opis oryginalnej wtyczki:
[`README-upstream.md`](README-upstream.md). Baza: Claudian `2.2.6`.

## Co dodaje

- **Pełny preset Claude Code** — wtyczka ładuje `CLAUDE.md` (globalny i projektowy), reguły
  z `.claude/rules/` i wybrany output style, tak jak CLI. Oryginał podaje własny prompt, który
  to wszystko zastępuje.
- **Polski interfejs.**
- **Limity planu 5h / 7d i zajętość kontekstu** w pasku pod polem wiadomości.
- **Steer, `/btw`, `/goal`** — wtrącenie w trakcie tury, pytanie poboczne bez psucia rozmowy,
  cel rozmowy.
- **Kafelki i wykresy `plus-ui`** — bloki kodu, które agent może wyrenderować jako elementy interfejsu.
- **Strony lokalne we wbudowanej przeglądarce** z przeładowaniem po zmianie pliku.
- **Archiwizacja rozmów.**
- **Projekty** — grupowanie rozmów w projekty na szerokiej liście sesji: + przy projekcie zaczyna w nim
  rozmowę, a rozmowy można przeciągać między projektami, „Sesjami” i „Przypiętymi”.
- **Czytanie innych rozmów** — agent widzi listę Twoich pozostałych rozmów i może je przeczytać
  (`list_sessions`, `read_session`), a `@` w polu wpisywania wskazuje mu konkretną rozmowę.
- **Awatar stanu** — widać, czy agent pracuje, czeka na odpowiedź, czy skończył; opcjonalnie
  okienko na pulpicie i sygnał na pasku zadań Windows, gdy Obsidian jest w tle.
- **Telegram i głosówki** — piszesz (albo mówisz) do agenta z telefonu, a poza domem dostajesz od niego
  głosówki po każdym etapie pracy.
- **Sekcja „Dodatki” w ustawieniach** — nazwa asystenta, awatar, most Telegrama, przełącznik kont.

## Instalacja (ręczna)

Wtyczki nie ma w sklepie Obsidiana.

```bash
git clone https://github.com/Eini666/claudian-plus.git
cd claudian-plus
npm install
npm run build
```

Skopiuj `main.js`, `manifest.json` i `styles.css` do `<vault>/.obsidian/plugins/claudian-plus/`,
potem w Obsidianie: *Ustawienia → Wtyczki społeczności* → włącz **Claudian Plus**.

**Nie włączaj jej razem z Claudianem ze sklepu w tym samym vaulcie.** Obie wtyczki rejestrują ten
sam typ widoku i trzymają ustawienia oraz rozmowy w tym samym folderze `.claudian/` w vaulcie.
Wyłącz jedną, zanim włączysz drugą — rozmowy i ustawienia przejdą, bo leżą poza folderem wtyczki.

## Telegram i głosówki

### Konfiguracja krok po kroku

1. W Telegramie napisz do **@BotFather**, wyślij `/newbot`, nadaj nazwę i skopiuj token.
2. W Obsidianie: *Ustawienia → Claudian Plus → Dodatki → Most Telegrama*. Włącz most i wybierz
   tryb **„Wbudowany bot”**.
3. Wklej token w polu **„Token bota”**.
4. Kliknij **„Połącz telefon”** i w ciągu 120 s wyślij swojemu botowi 6-cyfrowy kod pokazany w ustawieniach.
5. **„Narzędzia głosu”** — przy każdym brakującym narzędziu kliknij **„Zainstaluj”**: Piper
   (~21 MB), głos wybrany w polu „Głos” (~60 MB), ffmpeg (~110 MB).
6. **„Wyślij głosówkę testową”** — na telefonie powinna przyjść głosówka.
7. **„Rozpoznawanie mowy”** (opcjonalnie, żeby mówić do agenta głosówkami) — wybierz model
   i kliknij **„Zainstaluj”**: whisper.cpp (~8 MB) i model — `large-v3-turbo` dokładny (~550 MB)
   albo `small` szybki (~180 MB). Wszystko działa lokalnie, nagrania nie wychodzą z komputera.

### Na co dzień

- **„wychodzę”** — tryb poza domem: wiadomości z telefonu trafiają do aktywnej karty, a agent
  wysyła głosówki po każdym etapie i w odpowiedzi na wiadomości.
- **„wróciłem”** — tryb domowy: agent pisze tylko na ekranie, bot nie przyjmuje poleceń.
- **„nowy temat: …”** — otwiera nową kartę (nową rozmowę) i wysyła tam resztę wiadomości.
- **Głosówki od Ciebie** — z zainstalowanym rozpoznawaniem mowy możesz mówić zamiast pisać.
  Bot odsyła usłyszany tekst („Przekazane do …: „…””), więc od razu widzisz, co zrozumiał.
  Komendy „wychodzę” i „wróciłem” działają też głosem.
- Wiadomości wysłane, gdy Obsidian był zamknięty dłużej niż 5 minut, nie są wykonywane —
  bot prosi o ponowne wysłanie.
- Bot działa tylko przy otwartym Obsidianie.
- Jeden bot = jeden program. Nie podłączaj tego samego bota do dwóch programów naraz —
  będą sobie zabierać wiadomości.

### Prywatność

- Token i id czatu leżą w `~/.claudian-plus/telegram.json`, **poza vaultem** — nie trafią do
  synchronizacji ani do repozytorium vaulta. Narzędzia głosu: `~/.claudian-plus/bin`.
- Bot odpowiada tylko sparowanemu czatowi prywatnemu; wiadomości z innych czatów ignoruje.
- Claude zostawia teksty głosówek w folderze mostu (domyślnie `~/.claudian-plus/most`).

### Co pobiera instalator

Wersje są przypięte, a każdy plik jest przyjmowany tylko przy zgodnym rozmiarze i sumie SHA-256.

| Narzędzie | Skąd | Licencja |
|---|---|---|
| Piper `2023.11.14-2` | GitHub `rhasspy/piper` (release) | MIT; w paczce espeak-ng — GPL-3.0 |
| Głosy `pl_PL-gosia`, `darkman`, `mc_speech` (medium) | Hugging Face `rhasspy/piper-voices` | zbiory danych CC0; modele dostrojone z angielskiego głosu `lessac` — licencję bazowego modelu sprawdź w `MODEL_CARD` |
| ffmpeg `9.0.2` essentials | GitHub `GyanD/codexffmpeg` (build gyan.dev) | GPL-3.0 |
| whisper.cpp `v1.9.2` (`whisper-bin-x64.zip`, ~8 MB) | GitHub `ggml-org/whisper.cpp` (release) | MIT |
| Modele Whisper `large-v3-turbo` q5_0 (~550 MB), `small` q5_1 (~180 MB) | Hugging Face `ggerganov/whisper.cpp` | MIT (wagi OpenAI Whisper) |

Szybkość rozpoznawania (pomiar na Ryzen 7 5800X, 16 wątków): głosówka 8 s → `large-v3-turbo`
ok. 8 s, `small` ok. 2,5 s, oba bezbłędnie po polsku. Na słabszym procesorze proporcjonalnie wolniej.

**Instalacja ręczna**, gdy pobieranie padnie: pobierz te same pliki i ułóż je tak:

```
~/.claudian-plus/bin/
  piper/                         ← zawartość folderu piper/ z piper_windows_amd64.zip (z piper.exe)
  ffmpeg/ffmpeg.exe              ← z folderu bin/ archiwum ffmpeg
  glosy/pl_PL-gosia-medium/      ← pl_PL-gosia-medium.onnx i pl_PL-gosia-medium.onnx.json
  whisper/                       ← zawartość folderu Release/ z whisper-bin-x64.zip (z whisper-cli.exe)
  modele-mowy/large-v3-turbo/ggml-large-v3-turbo-q5_0.bin
  modele-mowy/small/ggml-small-q5_1.bin
```

### Tryb „Zewnętrzny program”

Dla tych, którzy mają własnego asystenta z botem. Wskazujesz folder mostu, a program pisze do
niego pliki:

- `poza-domem` — flaga trybu poza domem (przełącza ją też przycisk w pasku wtyczki),
- `wiadomosc.txt` — wiadomość z telefonu; wtyczka zabiera ją i wstawia do aktywnej karty.

Wbudowany bot używa w tym folderze jeszcze `czeka` (znacznik czasu ostatniej głosówki —
następna wiadomość to odpowiedź na nią) oraz skrzynki `glosowka-<id>.txt` → `glosowka-<id>.wynik`
(tekst od Claude → wynik wysyłki). W trybie zewnętrznym wtyczka tej skrzynki nie obsługuje
i nie dokleja instrukcji o głosówkach — jeśli chcesz ich, Twój program może przejąć ten sam układ.

### Ograniczenia

- Głos (synteza i rozpoznawanie mowy) działa tylko na Windows x64.
- Bez zainstalowanego rozpoznawania mowy bot na głosówkę odpowiada „napisz tekstem”.

## Przełącznik kont Claude

Dla osób z kilkoma kontami Claude (np. prywatne i firmowe). Przełączasz konto jednym kliknięciem
w pasku, bez `claude auth logout` / `login`, a przy każdym koncie widzisz zużycie limitu 5 h i 7 dni,
także na tych, na których akurat nie jesteś. Domyślnie wyłączony. Pasek limitów działa bez niego.

### Włączenie

1. *Ustawienia → Claudian Plus → Dodatki* → włącz **„Przełącznik kont”**.
2. Zostaw włączone **„Uruchamiaj panel kont”**. Wtyczka sama zapisze lokalny panel kont
   w `~/.claudian-plus/accounts/` i uruchomi go razem z Obsidianem (adres `http://127.0.0.1:7788`).
   Panel wymaga **Node.js 20.11 lub nowszego** w PATH. Bez niego „Stan panelu” pokaże „Brak Node.js”.
3. **„Otwórz panel”** → **„Zapisz bieżące konto”**. To konto, na którym Claude Code jest teraz zalogowany.
4. **„Dodaj konto”** dla każdego kolejnego: podaj nazwę (np. `praca`), otwórz link **w oknie
   prywatnym** przeglądarki (Ctrl+Shift+N), zaloguj się na to konto, skopiuj kod ze strony i wklej go
   w panelu. Zwykłe okno zalogowałoby konto, które masz już otwarte na claude.ai.
5. Otwórz kartę czatu ponownie. Obok paska limitów pojawi się plakietka konta z menu przełączania.

**Nie używaj `claude auth logout` do dodawania kont.** Wylogowanie może unieważnić token konta,
którego kopię panel właśnie zapisał.

### Na co dzień

- **Przełączenie** — plakietka w pasku albo przycisk „przełącz” w panelu. Menu pokazuje zużycie
  każdego konta. Przy długiej rozmowie widzisz też koszt przełączenia: cache promptu jest osobny dla
  każdego konta, więc nowe konto zapisuje cały kontekst od nowa (ok. 12,5× drożej niż odczyt).
  Przy bardzo dużym kontekście lepiej zacząć nową rozmowę.
- **Auto-switch** (włączany w panelu, domyślnie wyłączony) — gdy aktywne konto przekroczy 90%
  limitu, panel przełącza na najmniej zużyte konto poniżej progu. Nie przełącza, jeśli okno 5 h
  odnowi się za kilka minut. Próg zmienisz w `~/.claude/accounts/.autoswitch.json`.
- **„zaloguj ponownie”** — logowanie konta żyje ok. 4 tygodni od zalogowania. Gdy wygaśnie, panel
  pokaże przycisk i poprowadzi przez to samo okno prywatne i kod.
- Panel działa, dopóki działa Obsidian. Chcesz go mieć zawsze, także dla samego CLI? Wyłącz
  „Uruchamiaj panel kont” i dodaj zadanie autostartu (Windows, PowerShell):

```powershell
$dir = "$env:USERPROFILE\.claudian-plus\accounts"
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' `
  -Argument 'accounts.mjs serve 7788' -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName 'Konta Claude Code' -Action $action -Trigger $trigger
```

### Bezpieczeństwo

- `~/.claude/accounts/` zawiera **jawne tokeny logowania** każdego konta. Traktuj ten folder jak
  hasło: nie wrzucaj go do repozytorium, synchronizacji ani niezaszyfrowanej kopii w chmurze.
- Panel nasłuchuje tylko na `127.0.0.1` i odrzuca żądania ze stron innych niż sam panel i Obsidian.
  Przeglądarka dostaje adresy e-mail i procenty, tokeny nie opuszczają panelu.
- Przed każdym przełączeniem panel robi kopię plików logowania do `~/.claude/accounts/.backup/`.
- To narzędzie do **własnych** kont, za które płacisz, a nie do obchodzenia limitów.

### Ograniczenia

- Windows: testowane. Linux: powinien działać, nietestowany. **macOS: nie działa** — Claude Code
  trzyma tam logowanie w Keychainie, nie w pliku.
- Panel jest tylko po polsku.
- Wygasły token zwraca błąd `429`, nie `401` — jeśli panel pisze „token wygasł”, zaloguj konto ponownie.
- Endpoint limitów ma ostry rate limit. Panel trzyma odczyty w pamięci podręcznej i pyta tylko wtedy,
  gdy jest widoczny.

## Wymagania

- Obsidian desktop (Windows, macOS, Linux), wersja 1.13.0 lub nowsza
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) zainstalowany i zalogowany
- Node 24 do zbudowania wtyczki
- Głosówki: Windows x64
- Przełącznik kont: Node.js 20.11+ w PATH, Windows (Linux nietestowany, macOS nie)

Dodatki Claudian Plus są testowane tylko na Windows; funkcje głosowe wymagają Windows x64.

## Licencja

MIT — jak oryginał. Patrz [`LICENSE`](LICENSE). Kod zewnętrzny w `src/vendor/` ma własne licencje
w swoich folderach. Narzędzia głosu nie są częścią paczki — pobiera je instalator, każde na
własnej licencji (tabela wyżej).
