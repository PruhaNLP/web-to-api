import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-server.js';
import { MockProvider } from '../../helpers/mock-provider.js';

describe('Management endpoints', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe('GET /admin/providers', () => {
    it('returns provider statuses', async () => {
      ctx = createTestContext({
        providers: [
          new MockProvider('deepseek-web', { authenticated: true }),
          new MockProvider('kimi-web', { authenticated: false }),
        ],
      });
      const res = await ctx.app.request('/admin/providers');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers).toHaveLength(2);
      expect(body.providers.find((p: any) => p.id === 'deepseek-web').authenticated).toBe(true);
      expect(body.providers.find((p: any) => p.id === 'kimi-web').authenticated).toBe(false);
    });
  });

  describe('GET /admin/health', () => {
    it('returns health status', async () => {
      ctx = createTestContext();
      const res = await ctx.app.request('/admin/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('providers');
    });
  });

  describe('POST /admin/auth/import-state', () => {
    it('imports browser state and marks provider active', async () => {
      let importedOrigin = '';
      ctx = createTestContext({
        providers: [new MockProvider('qwen-web', { authenticated: false })],
        importBrowserState: async (state) => {
          importedOrigin = state.origin ?? '';
          return {
            origin: importedOrigin,
            cookiesImported: 1,
            localStorageImported: Object.keys(state.localStorage ?? {}).length,
            sessionStorageImported: 0,
          };
        },
      });

      const res = await ctx.app.request('/admin/auth/import-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: 'qwen-web',
          state: {
            origin: 'https://chat.qwen.ai',
            localStorage: { token: 'test-token' },
            cookies: [{ name: 'cna', value: 'cookie', domain: '.qwen.ai', path: '/' }],
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('imported');
      expect(body.providerId).toBe('qwen-web');
      expect(body.origin).toBe('https://chat.qwen.ai');
      expect(ctx.authStore.getStatus('qwen-web').status).toBe('active');
    });
  });
});
