import { createApp } from '../../src/server.js';
import { ProviderRegistry } from '../../src/core/registry.js';
import { AuthStore } from '../../src/auth/store.js';
import { MockProvider } from './mock-provider.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserStateImportPayload, BrowserStateImportResult } from '../../src/browser/manager.js';

export interface TestContext {
  app: ReturnType<typeof createApp>;
  registry: ProviderRegistry;
  authStore: AuthStore;
  stateDir: string;
  cleanup: () => void;
}

export function createTestContext(opts?: {
  authToken?: string;
  providers?: MockProvider[];
  importBrowserState?: (state: BrowserStateImportPayload) => Promise<BrowserStateImportResult>;
}): TestContext {
  const stateDir = join(tmpdir(), `wmb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });

  const registry = new ProviderRegistry();
  const authStore = new AuthStore(stateDir);

  const providers = opts?.providers ?? [
    new MockProvider('deepseek-web', {
      authenticated: true,
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxOutput: 8192 }],
    }),
  ];

  for (const p of providers) {
    registry.register(p);
  }

  const app = createApp({
    registry,
    authStore,
    authToken: opts?.authToken ?? null,
    importBrowserState: opts?.importBrowserState,
  });

  return {
    app,
    registry,
    authStore,
    stateDir,
    cleanup: () => rmSync(stateDir, { recursive: true, force: true }),
  };
}
