import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-server.js';
import { MockProvider } from '../helpers/mock-provider.js';

describe('Error handling integration', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  it('returns 400 for missing messages', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-web/claude-sonnet-4-6' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('returns 400 for invalid JSON body', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated provider', async () => {
    ctx = createTestContext({
      providers: [new MockProvider('test-provider', { authenticated: false })],
    });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test-provider/model',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe('authentication_error');
  });

  it('returns 403 with wrong Bearer token', async () => {
    ctx = createTestContext({ authToken: 'correct-token' });
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token',
      },
      body: JSON.stringify({
        model: 'claude-web/claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_token');
  });

  it('returns 400 for unknown provider in model ID', async () => {
    ctx = createTestContext();
    const res = await ctx.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nonexistent/model',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_model');
  });

  it('GET /v1/models returns only authenticated provider models', async () => {
    ctx = createTestContext({
      providers: [
        new MockProvider('auth-provider', { authenticated: true, models: [
          { id: 'model-1', name: 'Model 1', contextWindow: 100000, maxOutput: 4096 },
        ]}),
        new MockProvider('unauth-provider', { authenticated: false, models: [
          { id: 'model-2', name: 'Model 2', contextWindow: 100000, maxOutput: 4096 },
        ]}),
      ],
    });
    const res = await ctx.app.request('/v1/models');
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('auto');
    expect(body.data[1].id).toBe('auth-provider/model-1');
  });
});
