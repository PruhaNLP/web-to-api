import type { StreamEvent } from '../../core/stream.js';

/**
 * Normalize DeepSeek Web SSE events to internal StreamEvent format.
 *
 * DeepSeek Web API returns two formats:
 * 1. Web format: data: {"v":{"response":{"content":"...","thinking_content":"..."}}}
 * 2. OpenAI-like: data: {"choices":[{"delta":{"content":"..."}}]}
 */
export function normalizeDeepSeekSSE(line: string): StreamEvent[] {
  if (!line.startsWith('data: ')) return [];
  const data = line.slice(6);
  if (data === '[DONE]') return [{ type: 'done', reason: 'stop' }];

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  const events: StreamEvent[] = [];

  // Format 1: DeepSeek Web API format
  const response = parsed?.v?.response;
  if (response) {
    if (response.status === 'DONE' || response.status === 'done') {
      events.push({ type: 'done', reason: 'stop' });
      return events;
    }

    if (response.thinking_content && response.thinking_content.length > 0) {
      events.push({ type: 'thinking_delta', delta: response.thinking_content });
    }

    if (response.content && response.content.length > 0) {
      events.push({ type: 'text_delta', delta: response.content });
    }

    return events;
  }

  // Format 2: OpenAI-like format (fallback)
  const choice = parsed.choices?.[0];
  if (!choice) return [];

  if (choice.finish_reason) {
    const reason = choice.finish_reason === 'length' ? 'length' : 'stop';
    events.push({ type: 'done', reason });
    return events;
  }

  const delta = choice.delta;
  if (!delta) return [];

  if (delta.reasoning_content) {
    events.push({ type: 'thinking_delta', delta: delta.reasoning_content });
  }

  if (delta.content && delta.content.length > 0) {
    events.push({ type: 'text_delta', delta: delta.content });
  }

  return events;
}
