/**
 * Extracts the final textual result from subagent JSONL output.
 * Prefers all visible text blocks in the latest assistant message and falls back to top-level result.
 */
export function extractFinalResultFromSubagentJsonl(content: string): string | null {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith('{'));

  let lastAssistantText: string | null = null;
  let lastResultText: string | null = null;

  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const record = raw as {
      result?: unknown;
      message?: { role?: unknown; content?: unknown };
    };

    if (typeof record.result === 'string' && record.result.trim().length > 0) {
      lastResultText = record.result.trim();
    }

    if (record.message?.role !== 'assistant' || !Array.isArray(record.message.content)) {
      continue;
    }

    // Raport to wszystkie bloki tekstu ostatniej wiadomosci, nie tylko ostatni (upstream 42c6574f).
    const messageText: string[] = [];
    for (const blockRaw of record.message.content) {
      if (!blockRaw || typeof blockRaw !== 'object') {
        continue;
      }

      const block = blockRaw as { type?: unknown; text?: unknown };
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        messageText.push(block.text.trim());
      }
    }
    if (messageText.length > 0) {
      lastAssistantText = messageText.join('\n');
    }
  }

  return lastAssistantText ?? lastResultText;
}
