import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-server.js';
import { MockProvider } from '../../helpers/mock-provider.js';

class FailingMockProvider extends MockProvider {
  async *chat(): AsyncIterable<any> {
    yield { type: 'error', message: 'mock provider failed' };
  }
}

describe('POST /v1/chat/completions', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  it('returns streaming SSE response', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {');
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain('Hello from deepseek-web');
    expect(text).toContain('data: [DONE]');
  });

  it('returns non-streaming JSON response', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toContain('Hello from deepseek-web');
  });

  it('returns 400 for missing model', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('returns 400 for invalid model ID', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'no-slash',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_model');
  });

  it('returns 401 for unauthenticated provider', async () => {
    ctx = createTestContext({
      providers: [new MockProvider('deepseek-web', { authenticated: false })],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('auth_required');
  });

  it('returns 403 when auth token required but not provided', async () => {
    ctx = createTestContext({ authToken: 'secret-123' });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('passes with correct auth token', async () => {
    ctx = createTestContext({ authToken: 'secret-123' });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-123',
      },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
  });

  it('normalizes pseudo structured output for response_format', async () => {
    ctx = createTestContext({
      providers: [new MockProvider('deepseek-web', {
        responseText: '```json\n{"ok":true,"count":2}\n```',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
      })],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Return JSON' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'Result',
            schema: {
              type: 'object',
              required: ['ok'],
              properties: { ok: { type: 'boolean' }, count: { type: 'integer' } },
            },
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message.content).toBe('{"ok":true,"count":2}');
  });

  it('returns pseudo tool calls in non-streaming responses', async () => {
    ctx = createTestContext({
      providers: [new MockProvider('deepseek-web', {
        responseText: '{"tool_calls":[{"name":"search","arguments":{"query":"kimi"}}]}',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
      })],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Search' }],
        tools: [{
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          },
        }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.content).toBeNull();
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('search');
    expect(body.choices[0].message.tool_calls[0].function.arguments).toBe('{"query":"kimi"}');
  });

  it('returns pseudo tool calls in streaming responses', async () => {
    ctx = createTestContext({
      providers: [new MockProvider('deepseek-web', {
        responseText: '{"tool_calls":[{"name":"search","arguments":{"query":"deepseek"}}]}',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
      })],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Search' }],
        stream: true,
        tools: [{
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        }],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain('data: [DONE]');
  });

  it('routes auto model to the first available latency-ordered model', async () => {
    ctx = createTestContext({
      providers: [
        new MockProvider('qwen-web', {
          models: [{ id: 'qwen3.8-max', name: 'Qwen3.8 Max', contextWindow: 1000000, maxOutput: 8192 }],
        }),
        new MockProvider('deepseek-web', {
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
        }),
      ],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('qwen-web/qwen3.8-max');
    expect(body.choices[0].message.content).toContain('Hello from qwen-web');
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.estimated_context_tokens).toBe(body.usage.prompt_tokens);
  });

  it('falls back to the next auto model after a provider error', async () => {
    ctx = createTestContext({
      providers: [
        new FailingMockProvider('deepseek-web', {
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
        }),
        new MockProvider('kimi-web', {
          models: [{ id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 200000, maxOutput: 8192 }],
        }),
      ],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('kimi-web/kimi-k2.6');
    expect(body.choices[0].message.content).toContain('Hello from kimi-web');
  });

  it('accepts streaming auto requests while using non-stream fallback internally', async () => {
    ctx = createTestContext({
      providers: [new MockProvider('deepseek-web', {
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
      })],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"model":"deepseek-web/deepseek-v4-flash"');
    expect(text).toContain('Hello from deepseek-web');
    expect(text).toContain('data: [DONE]');
  });
});

describe('GET /v1/models', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  it('returns model list', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('list');
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].id).toBe('auto');
    expect(body.data[0].object).toBe('model');
  });

  it('sorts known web models by observed latency order', async () => {
    ctx = createTestContext({
      providers: [
        new MockProvider('qwen-web', {
          models: [{ id: 'qwen3.8-max', name: 'Qwen3.8 Max', contextWindow: 1000000, maxOutput: 8192 }],
        }),
        new MockProvider('kimi-web', {
          models: [{ id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 200000, maxOutput: 8192 }],
        }),
        new MockProvider('deepseek-web', {
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
        }),
      ],
    });
    const res = await ctx.app.request('/v1/models');
    const body = await res.json();
    expect(body.data.map((model: any) => model.id).slice(0, 4)).toEqual([
      'auto',
      'qwen-web/qwen3.8-max',
      'deepseek-web/deepseek-v4-flash',
      'kimi-web/kimi-k2.6',
    ]);
  });
});
