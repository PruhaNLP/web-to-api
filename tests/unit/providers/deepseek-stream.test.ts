import { describe, it, expect } from 'vitest';
import { normalizeDeepSeekSSE } from '../../../src/providers/deepseek/stream.js';

describe('DeepSeek stream normalizer', () => {
  it('parses text delta from standard SSE', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';
    const events = normalizeDeepSeekSSE(line);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
  });

  it('parses done signal', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}';
    const events = normalizeDeepSeekSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('parses [DONE] marker as done event', () => {
    expect(normalizeDeepSeekSSE('data: [DONE]')).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('ignores empty lines', () => {
    expect(normalizeDeepSeekSSE('')).toEqual([]);
  });

  it('ignores non-data lines', () => {
    expect(normalizeDeepSeekSSE('event: ping')).toEqual([]);
  });

  it('handles empty content delta', () => {
    const line = 'data: {"choices":[{"delta":{"content":""}}]}';
    expect(normalizeDeepSeekSSE(line)).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    expect(normalizeDeepSeekSSE('data: {invalid json}}}')).toEqual([]);
  });

  it('handles finish_reason length', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}';
    expect(normalizeDeepSeekSSE(line)).toEqual([{ type: 'done', reason: 'length' }]);
  });

  it('handles reasoning_content (thinking)', () => {
    const line = 'data: {"choices":[{"delta":{"reasoning_content":"Let me think..."}}]}';
    expect(normalizeDeepSeekSSE(line)).toEqual([{ type: 'thinking_delta', delta: 'Let me think...' }]);
  });
});
