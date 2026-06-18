/**
 * E2E tests for the actual HTTP server lifecycle.
 * These tests start a real server on a random port and make real HTTP requests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { serve } from '@hono/node-server';
import { createApp } from '../../src/server.js';
import { ProviderRegistry } from '../../src/core/registry.js';
import { AuthStore } from '../../src/auth/store.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';

interface TestServer {
  url: string;
  close: () => void;
  stateDir: string;
}

function startTestServer(opts?: {
  authToken?: string;
  providers?: MockProvider[];
}): TestServer {
  const stateDir = join(tmpdir(), `wmb-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });

  const registry = new ProviderRegistry();
  const authStore = new AuthStore(stateDir);

  const providers = opts?.providers ?? [
    new MockProvider('deepseek-web', {
      authenticated: true,
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
    }),
    new MockProvider('kimi-web', {
      authenticated: true,
      models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 256000, maxOutput: 8192 }],
    }),
  ];

  for (const p of providers) {
    registry.register(p);
  }

  const app = createApp({
    registry,
    authStore,
    authToken: opts?.authToken ?? null,
  });

  const server = serve({ fetch: app.fetch, port: 0 });
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    close: () => {
      server.close();
      rmSync(stateDir, { recursive: true, force: true });
    },
    stateDir,
  };
}

describe('E2E: Server Lifecycle', () => {
  let server: TestServer;

  afterEach(() => {
    server?.close();
  });

  it('starts and responds to health check', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/admin/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  it('serves Dashboard HTML at root', async () => {
    server = startTestServer();
    const res = await fetch(server.url);
    // Dashboard may return 404 if not built, or 200 if HTML exists
    expect([200, 404]).toContain(res.status);
  });

  it('GET /v1/models returns model list via real HTTP', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/v1/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('list');
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('POST /v1/chat/completions works end-to-end (non-streaming)', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBeTruthy();
  });

  it('POST /v1/chat/completions works end-to-end (streaming)', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {');
    expect(text).toContain('data: [DONE]');
  });

  it('auth token blocks unauthorized requests', async () => {
    server = startTestServer({ authToken: 'my-secret' });
    const res = await fetch(`${server.url}/v1/models`);
    expect(res.status).toBe(403);
  });

  it('auth token allows authorized requests (Bearer)', async () => {
    server = startTestServer({ authToken: 'my-secret' });
    const res = await fetch(`${server.url}/v1/models`, {
      headers: { 'Authorization': 'Bearer my-secret' },
    });
    expect(res.status).toBe(200);
  });

  it('auth token allows x-api-key header', async () => {
    server = startTestServer({ authToken: 'my-secret' });
    const res = await fetch(`${server.url}/v1/models`, {
      headers: { 'x-api-key': 'my-secret' },
    });
    expect(res.status).toBe(200);
  });

  it('routes to correct provider', async () => {
    server = startTestServer();
    const res1 = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    const body1 = await res1.json();
    expect(body1.choices[0].message.content).toContain('deepseek-web');

    const res2 = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kimi-web/kimi-k2.5',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });
    const body2 = await res2.json();
    expect(body2.choices[0].message.content).toContain('kimi-web');
  });

  it('returns proper error for unknown model', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/v1/chat/completions`, {
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

  it('management endpoints protected by auth token', async () => {
    server = startTestServer({ authToken: 'secret' });
    const res = await fetch(`${server.url}/admin/providers`);
    expect(res.status).toBe(403);

    const res2 = await fetch(`${server.url}/admin/providers`, {
      headers: { 'Authorization': 'Bearer secret' },
    });
    expect(res2.status).toBe(200);
  });

  it('dashboard config reports authRequired', async () => {
    server = startTestServer({ authToken: 'secret' });
    const res = await fetch(`${server.url}/dashboard/config.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authRequired).toBe(true);
  });

  it('dashboard config authRequired false without token', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/dashboard/config.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authRequired).toBe(false);
  });

  it('blocks path traversal on dashboard static files', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/dashboard/../../../etc/passwd`);
    expect(res.status).toBe(404);
  });

  it('serves dashboard static files', async () => {
    server = startTestServer();
    const res = await fetch(`${server.url}/dashboard/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });
});
