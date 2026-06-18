import type { StreamEvent } from '../../core/stream.js';

/**
 * Standard OpenAI-format SSE normalizer.
 * Shared by Qwen / GLM / Grok / Gemini / Perplexity / Doubao / Xiaomimo.
 */
export function normalizeStandardSSE(line: string): StreamEvent[] {
  if (!line.startsWith('data: ')) return [];
  const data = line.slice(6);
  if (data === '[DONE]') return [];

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  const choice = parsed.choices?.[0];
  if (!choice) return [];

  if (choice.finish_reason) {
    const reason = choice.finish_reason === 'length' ? 'length' : 'stop';
    return [{ type: 'done', reason }];
  }

  const delta = choice.delta;
  if (!delta) return [];

  if (delta.content && delta.content.length > 0) {
    return [{ type: 'text_delta', delta: delta.content }];
  }

  return [];
}
