import { extractFinalResultFromSubagentJsonl } from '@/utils/subagentJsonl';

describe('extractFinalResultFromSubagentJsonl', () => {
  it('joins every visible text block of the latest assistant message', () => {
    const content = [
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier note' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: [
        { type: 'text', text: 'Report heading' },
        { type: 'thinking', thinking: 'Private reasoning' },
        { type: 'text', text: 'Final answer' },
      ] } }),
    ].join('\n');

    expect(extractFinalResultFromSubagentJsonl(content)).toBe('Report heading\nFinal answer');
  });

  it('keeps the previous message text when the latest assistant message has none', () => {
    const content = [
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] } }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read' }] } }),
    ].join('\n');

    expect(extractFinalResultFromSubagentJsonl(content)).toBe('Answer');
  });

  it('falls back to the top-level result', () => {
    expect(extractFinalResultFromSubagentJsonl(JSON.stringify({ result: ' Done ' }))).toBe('Done');
  });
});
