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
4. Kliknij **„Połącz telefon”** i w ciągu 120 s napisz dowolną wiadomość do swojego bota.
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

Domyślnie wyłączony. Wymaga lokalnego panelu kont pod adresem z ustawień (panel w przygotowaniu).
Pasek limitów działa bez niego.

## Wymagania

- Obsidian desktop (Windows, macOS, Linux), wersja 1.13.0 lub nowsza
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) zainstalowany i zalogowany
- Node 24 do zbudowania wtyczki
- Głosówki: Windows x64

Dodatki Claudian Plus są testowane tylko na Windows; funkcje głosowe wymagają Windows x64.

## Licencja

MIT — jak oryginał. Patrz [`LICENSE`](LICENSE). Kod zewnętrzny w `src/vendor/` ma własne licencje
w swoich folderach. Narzędzia głosu nie są częścią paczki — pobiera je instalator, każde na
własnej licencji (tabela wyżej).
