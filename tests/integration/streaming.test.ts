import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-server.js';
import { DelayedMockProvider } from '../helpers/mock-sse.js';
import { MockProvider } from '../helpers/mock-provider.js';

describe('Streaming integration', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  it('streams multiple text deltas correctly', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'delayed-mock/test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    });
    const text = await res.text();
    const contents = text.split('\n')
      .filter(l => l.startsWith('data: {'))
      .map(l => JSON.parse(l.slice(6)))
      .map(c => c.choices?.[0]?.delta?.content)
      .filter(Boolean);
    expect(contents.join('')).toBe('Hello world');
  });

  it('non-streaming collects all deltas into one message', async () => {
    const provider = new DelayedMockProvider([
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'done', reason: 'stop' },
    ]);
    ctx = createTestContext({ providers: [provider] });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'delayed-mock/test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    const body = await res.json();
    expect(body.choices[0].message.content).toBe('Hello world');
  });

  it('routes to correct provider based on model ID', async () => {
    const claude = new MockProvider('claude-web', { authenticated: true });
    const deepseek = new MockProvider('deepseek-web', { authenticated: true });
    ctx = createTestContext({ providers: [claude, deepseek] });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/mock-model-1',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    const body = await res.json();
    expect(body.choices[0].message.content).toContain('deepseek-web');
  });
});
