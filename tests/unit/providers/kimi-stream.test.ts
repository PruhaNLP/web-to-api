import { describe, it, expect } from 'vitest';
import { normalizeKimiSSE } from '../../../src/providers/kimi-web/stream.js';

describe('Kimi stream normalizer', () => {
  it('parses text delta from Kimi cmpl event format', () => {
    const line = 'data: {"event":"cmpl","text":"Hello"}';
    const events = normalizeKimiSSE(line);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
  });

  it('parses Kimi all_done event', () => {
    const line = 'data: {"event":"all_done"}';
    const events = normalizeKimiSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('parses Kimi done event', () => {
    const line = 'data: {"event":"done"}';
    const events = normalizeKimiSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('parses text delta from standard SSE format', () => {
    const line = 'data: {"choices":[{"delta":{"content":"World"}}]}';
    const events = normalizeKimiSSE(line);
    expect(events).toEqual([{ type: 'text_delta', delta: 'World' }]);
  });

  it('parses done signal from standard format', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}';
    const events = normalizeKimiSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('parses length finish_reason from standard format', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}';
    const events = normalizeKimiSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'length' }]);
  });

  it('ignores [DONE] marker', () => {
    expect(normalizeKimiSSE('data: [DONE]')).toEqual([]);
  });

  it('ignores empty lines', () => {
    expect(normalizeKimiSSE('')).toEqual([]);
  });

  it('ignores non-data lines', () => {
    expect(normalizeKimiSSE('event: ping')).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    expect(normalizeKimiSSE('data: {invalid json}}}')).toEqual([]);
  });

  it('ignores cmpl event with no text', () => {
    const line = 'data: {"event":"cmpl"}';
    expect(normalizeKimiSSE(line)).toEqual([]);
  });

  it('ignores unknown event types', () => {
    const line = 'data: {"event":"unknown_event"}';
    expect(normalizeKimiSSE(line)).toEqual([]);
  });
});
