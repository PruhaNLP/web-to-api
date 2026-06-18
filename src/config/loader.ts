import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { parseProxySettings, type ProxySettings } from './proxy.js';
import { defaultChromeProfileDir } from './paths.js';

export interface BridgeConfig {
  server: {
    port: number;
    host: string;
    authToken: string | null;
    openDashboard: boolean;
  };
  browser: {
    profileDir: string;
    startupTimeout: number;
    idleShutdown: number;
    loginTimeout: number;
    mode: 'attach' | 'launch';
    cdpUrl: string;
    proxy: ProxySettings | null;
  };
  providers: {
    enabled: string[];
    defaultModel: string;
  };
  toolCalling: {
    enabled: boolean;
    language: 'auto' | 'zh' | 'en';
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file: string;
  };
}

export function defaultConfig(stateDir: string): BridgeConfig {
  return {
    server: {
      port: 3456,
      host: '127.0.0.1',
      authToken: null,
      openDashboard: true,
    },
    browser: {
      profileDir: defaultChromeProfileDir(),
      startupTimeout: 30000,
      idleShutdown: 300,
      loginTimeout: 180,
      mode: 'attach',
      cdpUrl: 'http://127.0.0.1:9222',
      proxy: null,
    },
    providers: {
      enabled: ['deepseek-web', 'kimi-web', 'qwen-web'],
      defaultModel: 'auto',
    },
    toolCalling: {
      enabled: true,
      language: 'auto',
    },
    logging: {
      level: 'info',
      file: join(stateDir, 'logs', 'server.log'),
    },
  };
}

interface LoadOptions {
  stateDir: string;
  configFile?: string;
  port?: number;
  host?: string;
  authToken?: string;
  verbose?: boolean;
  proxyServer?: string;
  proxyUser?: string;
  proxyPass?: string;
}

export function loadConfig(opts: LoadOptions): BridgeConfig {
  const config = defaultConfig(opts.stateDir);

  const configPath = opts.configFile ?? join(opts.stateDir, 'config.yml');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === 'object') {
      mergeDeep(config as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
    }
  } catch {
    // No config file or invalid YAML — use defaults
  }

  // Re-resolve log path relative to stateDir after YAML merge
  if (config.logging.file === defaultConfig('__placeholder__').logging.file) {
    config.logging.file = join(opts.stateDir, 'logs', 'bridge.log');
  }

  normalizeBrowserProxy(config.browser);

  // CLI overrides
  if (opts.port !== undefined) config.server.port = opts.port;
  if (opts.host !== undefined) config.server.host = opts.host;
  if (opts.authToken !== undefined) config.server.authToken = opts.authToken;
  if (opts.verbose) config.logging.level = 'debug';

  // CLI proxy overrides
  const cliProxy = parseProxySettings({
    server: opts.proxyServer,
    username: opts.proxyUser,
    password: opts.proxyPass,
  });
  if (cliProxy) config.browser.proxy = cliProxy;

  // Environment variable overrides (Docker-friendly)
  if (process.env.WTA_PORT) config.server.port = parseInt(process.env.WTA_PORT, 10);
  if (process.env.WTA_HOST) config.server.host = process.env.WTA_HOST;
  if (process.env.WTA_AUTH_TOKEN) config.server.authToken = process.env.WTA_AUTH_TOKEN;
  if (process.env.WTA_LOG_LEVEL) config.logging.level = process.env.WTA_LOG_LEVEL as any;
  if (process.env.WTA_STATE_DIR) {
    const stateFromEnv = process.env.WTA_STATE_DIR;
    config.logging.file = join(stateFromEnv, 'logs', 'server.log');
    // Only override profile if not set explicitly in YAML
    if (!yamlProfileExplicit(opts)) {
      config.browser.profileDir = join(stateFromEnv, 'chrome-profile');
    }
  }

  const envProxy = parseProxySettings({
    server: process.env.WTA_PROXY_SERVER,
    username: process.env.WTA_PROXY_USER,
    password: process.env.WTA_PROXY_PASS,
  });
  if (envProxy) config.browser.proxy = envProxy;

  return config;
}

function yamlProfileExplicit(opts: LoadOptions): boolean {
  const configPath = opts.configFile ?? join(opts.stateDir, 'config.yml');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> | undefined;
    const browser = parsed?.browser as Record<string, unknown> | undefined;
    return typeof browser?.profileDir === 'string' && browser.profileDir.length > 0;
  } catch {
    return false;
  }
}

function normalizeBrowserProxy(browser: BridgeConfig['browser']): void {
  const raw = browser.proxy as unknown;
  if (!raw || typeof raw !== 'object') {
    browser.proxy = null;
    return;
  }
  const obj = raw as { server?: string | null; username?: string | null; password?: string | null };
  browser.proxy = parseProxySettings(obj);
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      mergeDeep(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else if (srcVal !== undefined) {
      target[key] = srcVal;
    }
  }
}
