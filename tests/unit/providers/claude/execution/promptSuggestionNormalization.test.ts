import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeExecutionEventNormalizer } from '@/providers/claude/execution/ClaudeExecutionEventNormalizer';

/**
 * Sugestia nastepnej wiadomosci przychodzi PO `result` i NIE MOZE isc kanalem
 * `output`: tam `getOutputTarget()` zalozylby ture w tle i zapalil wskaznik pracy
 * po kazdej odpowiedzi. Musi wyjsc jako wlasne zdarzenie (14.09).
 */
const wiadomosc = (suggestion: unknown): SDKMessage => ({
  type: 'prompt_suggestion',
  suggestion,
  uuid: 'uuid-1',
  session_id: 'sesja-1',
} as unknown as SDKMessage);

describe('normalizacja sugestii nastepnej wiadomosci', () => {
  it('wypuszcza ja jako wlasne zdarzenie, nie jako output', () => {
    const normalizer = new ClaudeExecutionEventNormalizer();

    const events = normalizer.normalize(wiadomosc('zbuduj i wdroz'), 'requested');

    expect(events).toContainEqual({
      type: 'prompt_suggestion',
      suggestion: 'zbuduj i wdroz',
    });
    // Kanal `output` zakladaby ture w tle — tego pilnuje ta asercja.
    expect(events.some(e => e.type === 'output')).toBe(false);
  });

  it('przycina biale znaki', () => {
    const normalizer = new ClaudeExecutionEventNormalizer();

    const events = normalizer.normalize(wiadomosc('  odpal testy \n'), 'requested');

    expect(events).toContainEqual({
      type: 'prompt_suggestion',
      suggestion: 'odpal testy',
    });
  });

  it('milczy przy pustej sugestii — nie kasuje nia poprzedniej', () => {
    const normalizer = new ClaudeExecutionEventNormalizer();

    for (const pusta of ['', '   ', null, undefined, 42]) {
      const events = normalizer.normalize(wiadomosc(pusta), 'requested');
      expect(events.some(e => e.type === 'prompt_suggestion')).toBe(false);
    }
  });
});
