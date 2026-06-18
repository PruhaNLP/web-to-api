import type { StreamEvent } from '../../core/stream.js';

export function normalizeKimiSSE(line: string): StreamEvent[] {
  if (!line.startsWith('data: ')) return [];
  const data = line.slice(6);
  if (data === '[DONE]') return [];

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  // Kimi uses {"event":"cmpl","text":"..."} format
  if (parsed.event === 'cmpl' && parsed.text) {
    return [{ type: 'text_delta', delta: parsed.text }];
  }

  // Also support standard format
  const choice = parsed.choices?.[0];
  if (choice) {
    if (choice.finish_reason) {
      return [{ type: 'done', reason: choice.finish_reason === 'length' ? 'length' : 'stop' }];
    }
    if (choice.delta?.content) {
      return [{ type: 'text_delta', delta: choice.delta.content }];
    }
  }

  // Kimi done event
  if (parsed.event === 'all_done' || parsed.event === 'done') {
    return [{ type: 'done', reason: 'stop' }];
  }

  return [];
}
