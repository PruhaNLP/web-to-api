import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-server.js';
import { DelayedMockProvider } from '../helpers/mock-sse.js';

describe('SSE Conformance', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  function makeRequest(app: any, model: string) {
    return app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    });
  }

  it('Content-Type is text/event-stream', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hi' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await makeRequest(ctx.app, 'delayed-mock/test-model');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('each chunk is a complete data: {json} line', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await makeRequest(ctx.app, 'delayed-mock/test-model');
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    expect(lines.length).toBe(5);
    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      const parsed = JSON.parse(data);
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('object', 'chat.completion.chunk');
      expect(parsed).toHaveProperty('choices');
    }
  });

  it('first chunk includes role: assistant', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hi' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await makeRequest(ctx.app, 'delayed-mock/test-model');
    const text = await res.text();
    const firstDataLine = text.split('\n').find(l => l.startsWith('data: {'))!;
    const firstChunk = JSON.parse(firstDataLine.slice(6));
    expect(firstChunk.choices[0].delta.role).toBe('assistant');
  });

  it('last data line before [DONE] has finish_reason', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hi' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await makeRequest(ctx.app, 'delayed-mock/test-model');
    const text = await res.text();
    const dataLines = text.split('\n').filter(l => l.startsWith('data: '));
    const lastJson = dataLines[dataLines.length - 3];
    const parsed = JSON.parse(lastJson.slice(6));
    expect(parsed.choices[0].finish_reason).toBe('stop');
  });

  it('ends with data: [DONE]', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hi' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await makeRequest(ctx.app, 'delayed-mock/test-model');
    const text = await res.text();
    expect(text.trimEnd()).toMatch(/data: \[DONE\]$/);
  });

  it('all chunks share the same run ID', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'a' },
      { type: 'text_delta', delta: 'b' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await makeRequest(ctx.app, 'delayed-mock/test-model');
    const text = await res.text();
    const ids = text.split('\n')
      .filter(l => l.startsWith('data: {'))
      .map(l => JSON.parse(l.slice(6)).id);
    expect(new Set(ids).size).toBe(1);
  });
});
