/**
 * Podpowiedz nastepnej wiadomosci — prompt pomocniczy.
 *
 * CLI ma wlasny silnik sugestii, ale konsumentom SDK ich NIE wysyla (zmierzone
 * 13-14.09, piec rund). Wiec generujemy je sami: jeden tani strzal obok rozmowy,
 * ta sama droga co tytuly watkow.
 */
import { DEFAULT_LOCALE, getLocaleInfo } from '../../i18n/constants';

/** Liczy sie KONIEC odpowiedzi — tam stoi pytanie albo nastepny krok. */
const MAX_INPUT_CHARS = 1500;

/** Placeholder i tak przycina do 120; tu tniemy odpowiedz modelu. */
const MAX_SUGGESTION_CHARS = 120;

const SYSTEM_PROMPT_BASE = `You predict the user's NEXT message in a coding assistant chat.

You get the assistant's last reply. Write what the USER types next — short, as a person typing, not as a summary of the reply.

**Rules**:
1. Max 60 characters. One plain sentence or command.
2. No dashes, no parentheses, no trailing clarification. Stop at the point.
3. Answer the question the reply asked, pick the option it named, or order the next step it proposed.
4. Use ONLY what the reply states. Never invent a button, file, mechanism or step it did not mention.
5. Never restate, summarize or comment on the reply, and never describe what the user should do.
6. No quotes, no prefixes, no alternatives.
7. Nothing to continue? Output exactly: NONE

**Examples** — assistant reply, then the whole output:
Reply: "Built and deployed. Reload and check." → Works
Reply: "I can do variant A or B. Which one?" → Go with A
Reply: "Tests pass. Commit it?" → Commit it
Reply: "Here is the architecture summary." → NONE
Reply: "Paste what the field showed." → NONE`;

export function buildPromptSuggestionSystemPrompt(locale: string = DEFAULT_LOCALE): string {
  const localeInfo = getLocaleInfo(locale) ?? getLocaleInfo(DEFAULT_LOCALE);
  const language = localeInfo?.englishName ?? 'English';

  return `${SYSTEM_PROMPT_BASE}
8. **Language**: Write the message in ${language}. The examples above are English — never copy them, they only show the length and tone.

**Output**: Return ONLY the raw message text.`;
}

export function buildPromptSuggestionPrompt(assistantReply: string): string {
  const trimmed = assistantReply.trim();
  const tail = trimmed.length > MAX_INPUT_CHARS
    ? `...${trimmed.slice(-MAX_INPUT_CHARS)}`
    : trimmed;
  return `Assistant's last reply:\n"""\n${tail}\n"""\n\nThe user's next message:`;
}

/** `null` = nie ma czego podpowiadac (pusto, NONE albo sam znacznik). */
export function parsePromptSuggestionResponse(responseText: string): string | null {
  // Model lubi dolozyc druga linie z wariantem — bierzemy pierwsza niepusta.
  const firstLine = responseText
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0);
  if (!firstLine) return null;

  let suggestion = firstLine;
  if (
    (suggestion.startsWith('"') && suggestion.endsWith('"'))
    || (suggestion.startsWith("'") && suggestion.endsWith("'"))
  ) {
    suggestion = suggestion.slice(1, -1).trim();
  }
  // Markdown z listy albo cytatu: „- ", „* ", „> ", „1. ".
  suggestion = suggestion.replace(/^(?:[-*>]\s+|\d+[.)]\s+)/, '').trim();

  // Bariera w kodzie, nie w prompcie: zakaz doklejania wyjasnien model lamie,
  // a doklejka zawsze zaczyna sie myslnikiem (zmierzone 14.09 na zywym polu).
  suggestion = suggestion.split(/\s[—–-]\s/)[0].trim();

  if (!suggestion || suggestion.toUpperCase() === 'NONE') return null;
  if (suggestion.length > MAX_SUGGESTION_CHARS) {
    suggestion = `${suggestion.slice(0, MAX_SUGGESTION_CHARS - 1).trimEnd()}…`;
  }
  return suggestion || null;
}
