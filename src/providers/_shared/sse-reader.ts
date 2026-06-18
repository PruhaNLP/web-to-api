import type { StreamEvent } from '../../core/stream.js';

/**
 * Read SSE lines from a Response body and normalize them to StreamEvents.
 * Shared by all providers to eliminate code duplication.
 */
export async function* readSSE(
  response: Response,
  normalize: (line: string) => StreamEvent[],
): AsyncIterable<StreamEvent> {
  if (!response.body) {
    yield { type: 'error', message: 'No response body' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const events = normalize(trimmed);
      for (const event of events) {
        yield event;
      }
    }
  }

  if (buffer.trim()) {
    const events = normalize(buffer.trim());
    for (const event of events) {
      yield event;
    }
  }
}
