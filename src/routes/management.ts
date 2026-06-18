import { Hono } from 'hono';
import { ProviderRegistry } from '../core/registry.js';
import { AuthStore } from '../auth/store.js';
import type { BrowserStatus, LoginState } from '../browser/manager.js';
import type { BrowserStateImportPayload, BrowserStateImportResult } from '../browser/manager.js';
import type { MetricsCollector } from '../core/metrics.js';
import type { ErrorNotifier } from '../core/error-notifier.js';
import { getAutoModelOrder, resetAutoModelOrder, setAutoModelOrder } from '../core/auto-model-order.js';
import { loadRuntimeSettings, saveRuntimeSettings } from '../core/runtime-settings.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ======Settings=========
const SERVICE_NAME = 'web-to-api.service';
const SERVICE_LOG_LINES = 160;
const PROVIDER_IMPORTS: Array<{ providerId: string; files: string[]; origin: string }> = [
  { providerId: 'deepseek-web', files: ['deepseek-state.json'], origin: 'https://chat.deepseek.com' },
  { providerId: 'kimi-web', files: ['kimi-state.json', 'kimi.json'], origin: 'https://www.kimi.com' },
  { providerId: 'qwen-web', files: ['qwen-state.json', 'qwen.json'], origin: 'https://chat.qwen.ai' },
];
// ======Settings=========

const execFileAsync = promisify(execFile);

export interface ManagementDeps {
  registry: ProviderRegistry;
  authStore: AuthStore;
  onLogin?: (providerId: string) => Promise<{ status: string; message: string }>;
  getLoginState?: () => LoginState;
  getBrowserStatus?: () => BrowserStatus;
  importBrowserState?: (state: BrowserStateImportPayload) => Promise<BrowserStateImportResult>;
  startTime?: number;
  metrics?: MetricsCollector;
  errorNotifier?: ErrorNotifier | null;
  stateDir?: string;
}

export function managementRoutes(deps: ManagementDeps): Hono {
  const { registry, authStore, onLogin } = deps;
  const routeStartTime = deps.startTime ?? Date.now();
  const app = new Hono();

  app.get('/admin/providers', async (c) => {
    const statuses = await registry.providerStatus();
    return c.json({ providers: statuses });
  });

  app.post('/admin/providers/check-all', async (c) => {
    const statuses = await registry.providerStatus();
    return c.json({
      checkedAt: new Date().toISOString(),
      providers: statuses.map(status => ({
        ...status,
        status: status.authenticated ? 'active' : 'inactive',
        message: status.authenticated
          ? `${status.modelCount} model(s) available`
          : 'Not authenticated or cookies expired',
      })),
    });
  });

  app.post('/admin/providers/test-all', async (c) => {
    const statuses = await registry.providerStatus();
    const results: Record<string, { status: 'ok' | 'error'; message: string; latencyMs?: number }> = {};

    for (const status of statuses) {
      if (!status.authenticated) {
        results[status.id] = { status: 'error', message: 'Not authenticated' };
        continue;
      }

      const provider = registry.getProvider(status.id);
      if (!provider) continue;

      let models;
      try {
        models = await provider.models();
      } catch (e) {
        results[status.id] = { status: 'error', message: `Failed to fetch models: ${(e as Error).message}` };
        continue;
      }

      if (!models || models.length === 0) {
        results[status.id] = { status: 'error', message: 'No models found' };
        continue;
      }

      const start = Date.now();
      try {
        let text = '';
        const chatIter = provider.chat({
          model: models[0].id,
          messages: [{ role: 'user', content: 'respond only with "pong"' }],
          stream: false,
        });

        for await (const event of chatIter) {
          if (event.type === 'text_delta') text += event.delta;
          if (event.type === 'error') throw new Error(event.message);
        }
        results[status.id] = {
          status: 'ok',
          message: text.trim().slice(0, 50) || '(empty response)',
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        results[status.id] = {
          status: 'error',
          message: (err as Error).message,
          latencyMs: Date.now() - start,
        };
      }
    }

    return c.json({ testedAt: new Date().toISOString(), results });
  });

  app.post('/admin/auth/refresh-all', async (c) => {
    if (!deps.importBrowserState || !deps.stateDir) {
      return c.json({ error: 'Refresh not possible', message: 'Browser state or state dir not configured.' }, 503);
    }

    const sourceDir = deps.stateDir;
    const results: any[] = [];

    for (const provider of PROVIDER_IMPORTS) {
      let found = false;
      for (const fileName of provider.files) {
        const filePath = join(sourceDir, fileName);
        if (!existsSync(filePath)) continue;

        try {
          const state = normalizeStateFile(filePath, provider.origin);
          const result = await deps.importBrowserState(state);
          authStore.setStatus(provider.providerId, 'active');
          results.push({ providerId: provider.providerId, file: fileName, ...result });
          found = true;
          break;
        } catch (err) {
          results.push({ providerId: provider.providerId, file: fileName, error: (err as Error).message });
        }
      }
      if (!found) {
        results.push({ providerId: provider.providerId, status: 'skipped', message: 'No state files found' });
      }
    }

    return c.json({ status: 'completed', results });
  });

  app.post('/admin/notify/test', async (c) => {
    if (!deps.errorNotifier) {
      return c.json({ status: 'disabled', message: 'Telegram notifier is not configured.' }, 503);
    }
    await deps.errorNotifier.notify({
      route: '/admin/notify/test',
      status: 200,
      message: `Dashboard test notification ${new Date().toISOString()}`,
    });
    return c.json({ status: 'sent', message: 'Telegram test notification queued.' });
  });

  app.get('/admin/settings', async (c) => {
    return c.json({
      autoModelOrder: getAutoModelOrder(),
      persisted: deps.stateDir ? loadRuntimeSettings(deps.stateDir) : {},
      serviceName: SERVICE_NAME,
    });
  });

  app.post('/admin/settings/auto-order', async (c) => {
    let body: { order?: string[] };
    try {
      body = await c.req.json<{ order?: string[] }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (!Array.isArray(body.order)) {
      return c.json({ error: 'Invalid order', message: 'Body must include order: string[].' }, 400);
    }
    try {
      setAutoModelOrder(body.order);
      persistAutoModelOrder(deps.stateDir);
      return c.json({ status: 'saved', autoModelOrder: getAutoModelOrder() });
    } catch (err) {
      return c.json({ error: 'Save failed', message: (err as Error).message }, 400);
    }
  });

  app.post('/admin/settings/auto-order/reset', async (c) => {
    resetAutoModelOrder();
    persistAutoModelOrder(deps.stateDir);
    return c.json({ status: 'reset', autoModelOrder: getAutoModelOrder() });
  });

  app.get('/admin/service/logs', async (c) => {
    const lines = Math.min(Math.max(parseInt(c.req.query('lines') ?? String(SERVICE_LOG_LINES), 10) || SERVICE_LOG_LINES, 20), 500);
    try {
      const { stdout } = await execFileAsync('journalctl', [
        '--user',
        '-u',
        SERVICE_NAME,
        '-n',
        String(lines),
        '--no-pager',
        '--output',
        'short-iso',
      ], { timeout: 5000, maxBuffer: 256 * 1024 });
      return c.json({ service: SERVICE_NAME, logs: stdout });
    } catch (err) {
      return c.json({ error: 'Log read failed', message: (err as Error).message }, 500);
    }
  });

  app.post('/admin/service/restart', async (c) => {
    setTimeout(() => {
      void execFileAsync('systemctl', ['--user', 'restart', SERVICE_NAME]).catch(() => {});
    }, 250);
    return c.json({ status: 'restarting', service: SERVICE_NAME });
  });

  app.post('/admin/auth/login', async (c) => {
    let body: { providerId: string };
    try {
      body = await c.req.json<{ providerId: string }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const provider = registry.getProvider(body.providerId);
    if (!provider) {
      return c.json({ error: 'Unknown provider', message: `Provider "${body.providerId}" not found.` }, 404);
    }

    if (!onLogin) {
      return c.json({
        error: 'Browser not available',
        message: 'Browser manager is not configured. Restart the server.',
      }, 503);
    }

    try {
      // This returns immediately — login happens in background
      const result = await onLogin(body.providerId);
      return c.json(result);
    } catch (err) {
      return c.json({
        status: 'error',
        message: (err as Error).message,
      }, 500);
    }
  });

  // New: poll login progress
  app.get('/admin/auth/login-status', async (c) => {
    if (!deps.getLoginState) {
      return c.json({ providerId: null, status: 'idle', message: '' });
    }
    return c.json(deps.getLoginState());
  });

  app.post('/admin/auth/check', async (c) => {
    let body: { providerId: string };
    try {
      body = await c.req.json<{ providerId: string }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const status = authStore.getStatus(body.providerId);
    return c.json(status);
  });

  app.post('/admin/auth/logout', async (c) => {
    let body: { providerId: string };
    try {
      body = await c.req.json<{ providerId: string }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    authStore.clearStatus(body.providerId);
    return c.json({ status: 'logged_out', providerId: body.providerId });
  });

  app.post('/admin/auth/import-state', async (c) => {
    if (!deps.importBrowserState) {
      return c.json({ error: 'Browser not available', message: 'Browser state import is not configured.' }, 503);
    }

    let body: { providerId?: string; state?: BrowserStateImportPayload };
    try {
      body = await c.req.json<{ providerId?: string; state?: BrowserStateImportPayload }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.state || typeof body.state !== 'object') {
      return c.json({ error: 'Invalid state', message: 'Request body must include a state object.' }, 400);
    }

    try {
      const result = await deps.importBrowserState(body.state);
      if (body.providerId) {
        authStore.setStatus(body.providerId, 'active');
      }
      return c.json({ status: 'imported', providerId: body.providerId ?? null, ...result });
    } catch (err) {
      return c.json({ error: 'Import failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/admin/health', async (c) => {
    const statuses = await registry.providerStatus();
    const browserStatus = deps.getBrowserStatus ? deps.getBrowserStatus() : 'stopped';
    return c.json({
      status: 'healthy',
      uptime: Math.floor((Date.now() - routeStartTime) / 1000),
      browser: { status: browserStatus },
      providers: Object.fromEntries(
        statuses.map(s => [s.id, { authenticated: s.authenticated, models: s.modelCount }])
      ),
    });
  });

  app.get('/admin/metrics', async (c) => {
    if (!deps.metrics) return c.json({ error: 'Metrics not available' }, 503);
    return c.json(deps.metrics.getSummary());
  });

  app.get('/admin/logs', async (c) => {
    if (!deps.metrics) return c.json({ error: 'Metrics not available' }, 503);
    const count = parseInt(c.req.query('count') ?? '50', 10);
    return c.json({ logs: deps.metrics.getRecent(count) });
  });

  return app;
}

function persistAutoModelOrder(stateDir: string | undefined): void {
  if (!stateDir) return;
  const current = loadRuntimeSettings(stateDir);
  saveRuntimeSettings(stateDir, {
    ...current,
    autoModelOrder: getAutoModelOrder(),
  });
}

// ─── Cookie/State Helpers ───

function normalizeStateFile(filePath: string, fallbackOrigin: string): BrowserStateImportPayload {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));

  if (Array.isArray(parsed)) {
    return { origin: fallbackOrigin, cookies: parsed };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Unsupported state file format: ${filePath}`);
  }

  if (Array.isArray(parsed.cookies) && Array.isArray(parsed.origins)) {
    return normalizePlaywrightStorageState(parsed as any, fallbackOrigin);
  }

  return {
    url: typeof parsed.url === 'string' ? parsed.url : undefined,
    origin: typeof parsed.origin === 'string' ? parsed.origin : fallbackOrigin,
    localStorage: normalizeRecord((parsed as any).localStorage),
    sessionStorage: normalizeRecord((parsed as any).sessionStorage),
    cookies: typeof (parsed as any).cookies === 'string' || Array.isArray((parsed as any).cookies)
      ? (parsed as any).cookies
      : undefined,
  };
}

function normalizePlaywrightStorageState(state: any, fallbackOrigin: string): BrowserStateImportPayload {
  const matchedOrigin = state.origins.find((entry: any) => entry.origin === fallbackOrigin) || state.origins[0];
  const localStorage = Object.fromEntries(
    (matchedOrigin?.localStorage || [])
      .filter((entry: any) => typeof entry?.name === 'string')
      .map((entry: any) => [entry.name, String(entry.value ?? '')]),
  );

  return {
    origin: matchedOrigin?.origin || fallbackOrigin,
    localStorage,
    cookies: state.cookies,
  };
}

function normalizeRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, String(val ?? '')]),
  );
}
