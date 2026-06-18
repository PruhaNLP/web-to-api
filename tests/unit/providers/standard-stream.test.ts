import { describe, it, expect } from 'vitest';
import { normalizeStandardSSE } from '../../../src/providers/_shared/standard-stream.js';

describe('Standard stream normalizer', () => {
  it('parses text delta', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';
    const events = normalizeStandardSSE(line);
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
  });

  it('parses done signal with stop reason', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}';
    const events = normalizeStandardSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('parses done signal with length reason', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}';
    const events = normalizeStandardSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'length' }]);
  });

  it('maps unknown finish_reason to stop', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}';
    const events = normalizeStandardSSE(line);
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('ignores [DONE] marker', () => {
    expect(normalizeStandardSSE('data: [DONE]')).toEqual([]);
  });

  it('ignores empty lines', () => {
    expect(normalizeStandardSSE('')).toEqual([]);
  });

  it('ignores non-data lines', () => {
    expect(normalizeStandardSSE('event: ping')).toEqual([]);
  });

  it('handles empty content delta', () => {
    const line = 'data: {"choices":[{"delta":{"content":""}}]}';
    expect(normalizeStandardSSE(line)).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    expect(normalizeStandardSSE('data: {invalid json}}}')).toEqual([]);
  });

  it('handles missing choices array', () => {
    const line = 'data: {"id":"123"}';
    expect(normalizeStandardSSE(line)).toEqual([]);
  });

  it('handles empty choices array', () => {
    const line = 'data: {"choices":[]}';
    expect(normalizeStandardSSE(line)).toEqual([]);
  });

  it('handles missing delta in choice', () => {
    const line = 'data: {"choices":[{}]}';
    expect(normalizeStandardSSE(line)).toEqual([]);
  });
});
