import { Hono } from 'hono';
import { ProviderRegistry } from '../core/registry.js';
import { AuthStore } from '../auth/store.js';
import type { BrowserStatus, LoginState } from '../browser/manager.js';
import type { BrowserStateImportPayload, BrowserStateImportResult } from '../browser/manager.js';
import type { MetricsCollector } from '../core/metrics.js';
import type { ErrorNotifier } from '../core/error-notifier.js';
import { buildTelegramSettingsView } from '../core/error-notifier.js';
import {
  discoverTelegramChatIds,
  parseTelegramProxyFromBody,
  resolveTelegramToken,
  verifyTelegramBotToken,
} from '../core/telegram-bot-api.js';
import type { TelegramSettings } from '../core/runtime-settings.js';
import { getAutoModelOrder, resetAutoModelOrder, setAutoModelOrder } from '../core/auto-model-order.js';
import { loadRuntimeSettings, saveRuntimeSettings } from '../core/runtime-settings.js';
import { PROVIDER_SESSION_SPECS } from '../session/import-config.js';
import { defaultImportsSourceDir, findImportCandidates, persistImportRawFile, resolveImportPersistFilename, type ImportPersistKind } from '../session/import.js';
import { tailLogFile } from '../core/logger.js';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

// ======Settings=========
const SERVICE_NAME = 'web-to-api.service';
const SERVICE_LOG_LINES = 160;
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
  logFilePath?: string;
  reloadTelegramNotifier?: () => void;
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

  app.get('/admin/imports', async (c) => {
    const dir = deps.stateDir ? defaultImportsSourceDir(deps.stateDir) : null;
    return c.json({
      importsDir: dir,
      providers: PROVIDER_SESSION_SPECS,
    });
  });

  app.post('/admin/auth/refresh-all', async (c) => {
    if (!deps.importBrowserState || !deps.stateDir) {
      return c.json({ error: 'Refresh not possible', message: 'Browser state or state dir not configured.' }, 503);
    }

    const sourceDir = defaultImportsSourceDir(deps.stateDir);
    const candidates = findImportCandidates(sourceDir);

    if (candidates.length === 0) {
      return c.json({
        status: 'no_files',
        importsDir: sourceDir,
        message: `No session JSON in ${sourceDir}. Use Session Import or copy files there.`,
        results: [],
      });
    }

    const results = [];
    for (const candidate of candidates) {
      try {
        const detail = await deps.importBrowserState(candidate.state);
        authStore.setStatus(candidate.providerId, 'active');
        results.push({
          providerId: candidate.providerId,
          file: candidate.fileName,
          status: 'imported',
          detail,
        });
      } catch (err) {
        results.push({
          providerId: candidate.providerId,
          file: candidate.fileName,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    return c.json({ status: 'completed', importsDir: sourceDir, results });
  });

  app.post('/admin/notify/test', async (c) => {
    const notifier = deps.errorNotifier;
    if (!notifier) {
      return c.json({ status: 'disabled', message: 'Telegram notifier is not configured.' }, 503);
    }
    await notifier.notify({
      route: '/admin/notify/test',
      status: 200,
      message: `Dashboard test notification ${new Date().toISOString()}`,
    });
    return c.json({ status: 'sent', message: 'Telegram test notification queued.' });
  });

  app.get('/admin/settings', async (c) => {
    const persisted = deps.stateDir ? loadRuntimeSettings(deps.stateDir) : {};
    return c.json({
      autoModelOrder: getAutoModelOrder(),
      persisted: {
        autoModelOrder: persisted.autoModelOrder,
      },
      telegram: buildTelegramSettingsView(persisted.telegram),
      serviceName: SERVICE_NAME,
    });
  });

  app.post('/admin/settings/telegram', async (c) => {
    if (!deps.stateDir) {
      return c.json({ error: 'No state dir', message: 'Telegram settings require state directory.' }, 503);
    }

    let body: {
      botToken?: string;
      chatId?: string;
      proxyServer?: string;
      proxyUser?: string;
      proxyPass?: string;
    };
    try {
      body = await c.req.json<typeof body>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const current = loadRuntimeSettings(deps.stateDir);
    const telegram: TelegramSettings = { ...(current.telegram || {}) };

    if (body.chatId !== undefined) {
      telegram.chatId = String(body.chatId).trim();
    }
    if (body.botToken !== undefined) {
      const token = String(body.botToken).trim();
      if (token) telegram.botToken = token;
    }
    const proxyParsed = parseTelegramProxyFromBody(body, telegram.proxy);
    if (proxyParsed !== undefined) {
      if (proxyParsed === null) {
        delete telegram.proxy;
      } else {
        telegram.proxy = proxyParsed;
      }
    }

    if (!telegram.botToken || !telegram.chatId) {
      return c.json({
        error: 'Incomplete telegram settings',
        message: 'botToken and chatId are required.',
      }, 400);
    }

    saveRuntimeSettings(deps.stateDir, { ...current, telegram });
    deps.reloadTelegramNotifier?.();

    const view = buildTelegramSettingsView(telegram);
    return c.json({
      status: 'saved',
      telegram: view,
      message: view.configured ? 'Telegram notifier updated.' : 'Saved, but notifier is still incomplete.',
    });
  });

  app.post('/admin/telegram/verify-token', async (c) => {
    if (!deps.stateDir) {
      return c.json({ error: 'No state dir' }, 503);
    }
    let body: {
      botToken?: string;
      proxyServer?: string;
      proxyUser?: string;
      proxyPass?: string;
    };
    try {
      body = await c.req.json<typeof body>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const settings = resolveTelegramDraftSettings(deps.stateDir, body);
    const token = resolveTelegramToken(body.botToken, settings);
    if (!token) {
      return c.json({ error: 'Missing token', message: 'Provide botToken or save it first.' }, 400);
    }

    try {
      const bot = await verifyTelegramBotToken(token, settings);
      const view = buildTelegramSettingsView(settings);
      return c.json({
        status: 'ok',
        bot,
        proxyLabel: view.proxy?.label ?? 'direct (api.telegram.org)',
      });
    } catch (err) {
      return c.json({ error: 'Verify failed', message: (err as Error).message }, 400);
    }
  });

  app.post('/admin/telegram/discover-chats', async (c) => {
    if (!deps.stateDir) {
      return c.json({ error: 'No state dir' }, 503);
    }
    let body: {
      botToken?: string;
      proxyServer?: string;
      proxyUser?: string;
      proxyPass?: string;
    };
    try {
      body = await c.req.json<typeof body>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const settings = resolveTelegramDraftSettings(deps.stateDir, body);
    const token = resolveTelegramToken(body.botToken, settings);
    if (!token) {
      return c.json({ error: 'Missing token', message: 'Verify bot token first.' }, 400);
    }

    try {
      await verifyTelegramBotToken(token, settings);
    } catch (err) {
      return c.json({ error: 'Token invalid', message: (err as Error).message }, 400);
    }

    try {
      const { chats, consumedUpdates } = await discoverTelegramChatIds(token, settings);
      if (chats.length === 0) {
        return c.json({
          status: 'empty',
          chats: [],
          message: 'No messages yet. Open your bot in Telegram, send any message (e.g. /start), then try again.',
          consumedUpdates,
        });
      }
      return c.json({ status: 'ok', chats, consumedUpdates });
    } catch (err) {
      return c.json({ error: 'Discover failed', message: (err as Error).message }, 400);
    }
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
    const logResult = await readServiceLogs(deps, lines);
    return c.json(logResult);
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

    let body: {
      providerId?: string;
      state?: BrowserStateImportPayload;
      raw?: unknown;
      persistKind?: ImportPersistKind;
      persistFile?: string;
    };
    try {
      body = await c.req.json<typeof body>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.state || typeof body.state !== 'object') {
      return c.json({ error: 'Invalid state', message: 'Request body must include a state object.' }, 400);
    }

    try {
      let savedTo: string | null = null;
      if (deps.stateDir && body.providerId) {
        const fileName = body.persistFile
          ?? (body.persistKind ? resolveImportPersistFilename(body.providerId, body.persistKind) : null);
        if (fileName && body.raw !== undefined) {
          savedTo = persistImportRawFile(deps.stateDir, fileName, body.raw);
        }
      }

      const result = await deps.importBrowserState(body.state);
      if (body.providerId) {
        authStore.setStatus(body.providerId, 'active');
      }
      return c.json({
        status: 'imported',
        providerId: body.providerId ?? null,
        savedTo,
        ...result,
      });
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

function resolveTelegramDraftSettings(
  stateDir: string,
  body: {
    botToken?: string;
    proxyServer?: string;
    proxyUser?: string;
    proxyPass?: string;
  },
): TelegramSettings | undefined {
  const persisted = loadRuntimeSettings(stateDir).telegram || {};
  const draft: TelegramSettings = { ...persisted };
  if (body.botToken?.trim()) draft.botToken = body.botToken.trim();
  const proxyParsed = parseTelegramProxyFromBody(body, persisted.proxy);
  if (proxyParsed !== undefined) {
    if (proxyParsed === null) {
      delete draft.proxy;
    } else {
      draft.proxy = proxyParsed;
    }
  }
  return draft;
}

function persistAutoModelOrder(stateDir: string | undefined): void {
  if (!stateDir) return;
  const current = loadRuntimeSettings(stateDir);
  saveRuntimeSettings(stateDir, {
    ...current,
    autoModelOrder: getAutoModelOrder(),
  });
}

async function readServiceLogs(
  deps: ManagementDeps,
  lines: number,
): Promise<{ service?: string; source: string; logs: string }> {
  if (deps.logFilePath && existsSync(deps.logFilePath)) {
    const logs = tailLogFile(deps.logFilePath, lines);
    if (logs.trim()) {
      return { source: deps.logFilePath, logs };
    }
  }

  if (deps.stateDir) {
    const logsDir = join(deps.stateDir, 'logs');
    if (existsSync(logsDir)) {
      const files = readdirSync(logsDir)
        .filter(name => name.endsWith('.log'))
        .map(name => join(logsDir, name))
        .filter(path => existsSync(path));
      if (files.length > 0) {
        const latest = files.sort().at(-1)!;
        const logs = tailLogFile(latest, lines);
        if (logs.trim()) {
          return { source: latest, logs };
        }
      }
    }
  }

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
    const trimmed = stdout.trim();
    if (trimmed && !trimmed.includes('-- No entries --')) {
      return { service: SERVICE_NAME, source: 'journalctl', logs: stdout };
    }
  } catch {
    // fall through
  }

  if (deps.metrics) {
    const recent = deps.metrics.getRecent(lines);
    if (recent.length > 0) {
      const text = recent.map(entry => {
        const ts = new Date(entry.timestamp).toISOString();
        const err = entry.errorCode ? ` error=${entry.errorCode}` : '';
        return `${ts} ${entry.provider} ${entry.model} ${entry.status} ${entry.latencyMs}ms${err}`;
      }).join('\n');
      return { source: 'request-metrics', logs: text };
    }
  }

  const logHint = deps.logFilePath ?? join(deps.stateDir ?? '~/.web-to-api', 'logs', 'server.log');
  return {
    source: 'none',
    logs: [
      'Log file is empty or not created yet.',
      `Expected path: ${logHint}`,
      '',
      'Restart the server — logs are written on startup.',
    ].join('\n'),
  };
}
