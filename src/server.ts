import { Hono } from 'hono';
import { openaiRoutes } from './routes/openai-compat.js';
import { managementRoutes, type ManagementDeps } from './routes/management.js';
import { ProviderRegistry } from './core/registry.js';
import { AuthStore } from './auth/store.js';
import type { BrowserStatus, LoginState } from './browser/manager.js';
import type { BrowserStateImportPayload, BrowserStateImportResult } from './browser/manager.js';
import { InvalidTokenError, errorToHttpResponse } from './core/errors.js';
import type { ErrorNotifier } from './core/error-notifier.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  registry: ProviderRegistry;
  authStore: AuthStore;
  authToken: string | null;
  stateDir?: string;
  onLogin?: (providerId: string) => Promise<{ status: string; message: string }>;
  getBrowserStatus?: () => BrowserStatus;
  getLoginState?: () => LoginState;
  importBrowserState?: (state: BrowserStateImportPayload) => Promise<BrowserStateImportResult>;
  errorNotifier?: ErrorNotifier | null;
}

export function createApp(opts: AppOptions): Hono {
  const app = new Hono();

  // Auth middleware for API routes (/v1/* and /admin/*)
  if (opts.authToken) {
    const checkToken = async (c: any, next: any) => {
      const authHeader = c.req.header('Authorization');
      const xApiKey = c.req.header('x-api-key');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : xApiKey ?? null;
      if (token !== opts.authToken) {
        const res = errorToHttpResponse(new InvalidTokenError());
        return c.json(res.body, res.status as any);
      }
      await next();
    };
    app.use('/v1/*', checkToken);
    app.use('/admin/*', checkToken);
  }

  // Dashboard
  app.get('/', (c) => {
    try {
      const html = readFileSync(join(__dirname, 'dashboard', 'index.html'), 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Dashboard available after build. Run: npx tsup', 404);
    }
  });

  app.get('/dashboard/:file', (c) => {
    const file = c.req.param('file');
    const ext = file.split('.').pop();
    const contentType = ext === 'js' ? 'application/javascript'
      : ext === 'css' ? 'text/css'
      : 'text/plain';
    try {
      const content = readFileSync(join(__dirname, 'dashboard', file), 'utf-8');
      return c.text(content, 200, { 'Content-Type': contentType });
    } catch {
      return c.text('Not found', 404);
    }
  });

  // Mount API routes
  app.route('/', openaiRoutes(opts.registry, opts.errorNotifier ?? null));

  const mgmtDeps: ManagementDeps = {
    registry: opts.registry,
    authStore: opts.authStore,
    onLogin: opts.onLogin,
    getLoginState: opts.getLoginState,
    getBrowserStatus: opts.getBrowserStatus,
    importBrowserState: opts.importBrowserState,
    errorNotifier: opts.errorNotifier ?? null,
    stateDir: opts.stateDir,
    startTime: Date.now(),
  };
  app.route('/', managementRoutes(mgmtDeps));

  return app;
}
