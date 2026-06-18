import { program } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { serve } from '@hono/node-server';
import { createApp } from './server.js';
import { loadConfig } from './config/loader.js';
import { toChromeProxyArg, proxyDisplayLabel, type ProxySettings } from './config/proxy.js';
import { defaultChromeProfileDir, defaultStateDir, ensureStateLayout, isSnapChromiumProfileBlocked } from './config/paths.js';
import { ProviderRegistry } from './core/registry.js';
import { AuthStore } from './auth/store.js';
import { BrowserManager } from './browser/manager.js';
import { DeepSeekProvider } from './providers/deepseek/index.js';
import { KimiProvider } from './providers/kimi-web/index.js';
import { QwenProvider } from './providers/qwen-web/index.js';
import type { BaseProvider } from './core/provider.js';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runDoctor, printDoctorResults, findChromePath } from './doctor.js';
import { createTelegramErrorNotifier, mergeTelegramSettings, MutableErrorNotifier } from './core/error-notifier.js';
import { setAutoModelOrder } from './core/auto-model-order.js';
import { loadRuntimeSettings } from './core/runtime-settings.js';
import { defaultImportsSourceDir, findImportCandidates, importSessionsFromDir } from './session/import.js';
import { initFileLogger, getLogFilePath } from './core/logger.js';

const PKG = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
) as { name: string; version: string };

// ======Settings=========
const DEFAULT_SERVICE_NAME = 'web-to-api';
const DEFAULT_SERVICE_ENV_DIR = join(homedir(), '.config', 'web-to-api');
const DEFAULT_SERVICE_ENV_FILE = join(DEFAULT_SERVICE_ENV_DIR, 'env');
const DEFAULT_SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user');
// ======Settings=========

const PROVIDER_MAP: Record<string, new (auth: AuthStore, fetch?: (url: string, init: RequestInit) => Promise<Response>, getPage?: (origin: string) => Promise<import('playwright-core').Page>) => BaseProvider> = {
  'deepseek-web': DeepSeekProvider,
  'kimi-web': KimiProvider,
  'qwen-web': QwenProvider,
};

const DEFAULT_STATE_DIR = defaultStateDir();

// ─── Helpers ───

/** Check if a port is available */
function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, host);
  });
}

/** Find an available port starting from preferred */
async function findAvailablePort(preferred: number, host: string): Promise<number> {
  for (let port = preferred; port < preferred + 100; port++) {
    if (await isPortAvailable(port, host)) return port;
  }
  throw new Error(`No available port found in range ${preferred}-${preferred + 99}`);
}

/** Check if Chrome is running (any instance) */
function isChromeRunning(): boolean {
  try {
    const os = platform();
    if (os === 'darwin') {
      execSync('pgrep -x "Google Chrome"', { stdio: 'ignore' });
      return true;
    } else if (os === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /NH', { encoding: 'utf-8' });
      return out.includes('chrome.exe');
    } else {
      execSync('pgrep -x "chrome|chromium|google-chrome"', { stdio: 'ignore' });
      return true;
    }
  } catch {
    return false;
  }
}

/** Check if CDP is available */
async function checkCDP(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Try to launch Chrome with debugging port */
async function launchChromeWithCDP(cdpPort: number, profileDir: string, proxy?: ProxySettings | null): Promise<boolean> {
  const chromePath = findChromePath();
  if (!chromePath) return false;

  // Must use non-default profile dir — Chrome refuses CDP on default profile
  mkdirSync(profileDir, { recursive: true });
  const proxyArg = proxy ? ` ${toChromeProxyArg(proxy)}` : '';
  const sandboxArg = platform() === 'linux' ? ' --no-sandbox' : '';
  const args = `--remote-debugging-port=${cdpPort} --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check${sandboxArg}${proxyArg}`;

  try {
    const os = platform();
    if (os === 'darwin') {
      execSync(`"${chromePath}" ${args} &>/dev/null &`, { shell: '/bin/zsh' });
    } else if (os === 'win32') {
      execSync(`start "" "${chromePath}" ${args}`, { shell: 'cmd.exe' });
    } else {
      execSync(`nohup "${chromePath}" ${args} >/dev/null 2>&1 &`, { shell: '/bin/bash' });
    }

    // Wait for CDP to become available (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await checkCDP(`http://127.0.0.1:${cdpPort}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Get platform-specific Chrome launch command for display */
function getChromeCommand(port: number, profileDir: string, proxy?: ProxySettings | null): string {
  const chromePath = findChromePath() ?? 'google-chrome';
  const proxyArg = proxy ? ` ${toChromeProxyArg(proxy)}` : '';
  const sandboxArg = platform() === 'linux' ? ' --no-sandbox' : '';
  return `"${chromePath}" --remote-debugging-port=${port} --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check${sandboxArg}${proxyArg}`;
}

// ─── Main ───

program
  .name(PKG.name)
  .description('Turn free web AI chat sessions into a local OpenAI-compatible API')
  .version(PKG.version)
  .option('-p, --port <port>', 'listen port', parseInt)
  .option('--host <host>', 'bind address')
  .option('--auth-token <token>', 'require Bearer token for API access')
  .option('--no-open', 'do not open dashboard in browser')
  .option('--state-dir <dir>', 'data directory', DEFAULT_STATE_DIR)
  .option('--config <file>', 'config file path')
  .option('-v, --verbose', 'verbose logging')
  .option('--browser-mode <mode>', 'browser mode: attach (default) or launch', 'attach')
  .option('--cdp-url <url>', 'Chrome CDP URL for attach mode', 'http://127.0.0.1:9222')
  .option('--chrome-profile <dir>', 'Chrome user data directory')
  .option('--proxy-server <url>', 'HTTP proxy for Chrome (e.g. http://host:port)')
  .option('--proxy-user <user>', 'proxy login')
  .option('--proxy-pass <pass>', 'proxy password')
  .action(async (opts) => {
    console.log('');

    const stateDir = opts.stateDir;
    const layout = ensureStateLayout(stateDir);
    console.log(chalk.green('  ✓') + ` State: ${chalk.cyan(layout.stateDir)}`);
    console.log(chalk.green('  ✓') + ` Session imports: ${chalk.cyan(layout.importsDir)}`);

    // ── Step 1: Environment check ──
    const doctorResults = await runDoctor();
    const hasFatal = doctorResults.some(r => r.status === 'fail');
    if (hasFatal) {
      printDoctorResults(doctorResults);
      console.log(chalk.red('  Cannot start. Please fix the issues above.'));
      process.exit(1);
    }
    if (opts.verbose) {
      printDoctorResults(doctorResults);
    }

    const config = loadConfig({
      stateDir,
      configFile: opts.config,
      port: opts.port,
      host: opts.host,
      authToken: opts.authToken,
      verbose: opts.verbose,
      proxyServer: opts.proxyServer,
      proxyUser: opts.proxyUser,
      proxyPass: opts.proxyPass,
    });

    const logFile = initFileLogger(config.logging.file, config.logging.level);
    console.log(chalk.green('  ✓') + ` Logs: ${chalk.cyan(logFile)}`);

    const proxy = config.browser.proxy;
    const runtimeSettings = loadRuntimeSettings(stateDir);
    if (runtimeSettings.autoModelOrder?.length) {
      setAutoModelOrder(runtimeSettings.autoModelOrder);
      console.log(chalk.green('  ✓') + ' Loaded runtime auto model order');
    }

    // ── Step 2: Find available port ──
    let serverPort = config.server.port;
    const serverHost = config.server.host;
    if (!(await isPortAvailable(serverPort, serverHost))) {
      const oldPort = serverPort;
      serverPort = await findAvailablePort(serverPort + 1, serverHost);
      console.log(chalk.yellow(`  ⚠ Port ${oldPort} in use, using ${serverPort} instead`));
    }

    // ── Step 3: Browser setup ──
    let browserMode = (opts.browserMode === 'launch' ? 'launch' : 'attach') as 'attach' | 'launch';
    const cdpPort = parseInt(new URL(opts.cdpUrl).port, 10) || 9222;
    const cdpUrl = opts.cdpUrl;
    // Chrome profile: custom > config > default
    const chromeProfileDir = opts.chromeProfile ?? config.browser.profileDir ?? defaultChromeProfileDir();

    if (isSnapChromiumProfileBlocked(chromeProfileDir)) {
      console.log(chalk.yellow('  ⚠ Snap Chromium cannot use profile inside a dot-folder in $HOME'));
      console.log(chalk.yellow(`    Current: ${chromeProfileDir}`));
      console.log(chalk.cyan('    Use: --chrome-profile ~/web-to-api/chrome-profile'));
      console.log('');
    }

    if (proxy) {
      console.log(chalk.green('  ✓') + ` Proxy: ${chalk.cyan(proxyDisplayLabel(proxy))}`);
      if (browserMode === 'attach' && proxy.username) {
        console.log(chalk.yellow('  ⚠ Auth proxy + attach mode: use --browser-mode launch on headless servers'));
      }
    }

    if (browserMode === 'attach') {
      const cdpAvailable = await checkCDP(cdpUrl);

      if (cdpAvailable) {
        console.log(chalk.green('  ✓') + ` Chrome CDP connected at ${cdpUrl}`);
      } else {
        // CDP not available — figure out why and try to fix
        const chromeRunning = isChromeRunning();

        if (chromeRunning) {
          // Chrome is running but WITHOUT debugging port
          // Try launching a SECOND Chrome with independent profile + CDP
          console.log(chalk.gray('  … Chrome running without CDP. Launching a dedicated instance...'));

          const launched = await launchChromeWithCDP(cdpPort, chromeProfileDir, proxy);
          if (launched) {
            console.log(chalk.green('  ✓') + ` Dedicated Chrome launched with CDP at port ${cdpPort}`);
            console.log(chalk.gray(`    Profile: ${chromeProfileDir}`));
            console.log(chalk.gray('    First time? Login via Dashboard after server starts.'));
          } else {
            console.log(chalk.yellow('  ⚠ Could not launch dedicated Chrome.'));
            console.log(chalk.yellow('    Option 1: Quit Chrome (Cmd+Q), then run web-to-api again'));
            console.log(chalk.yellow('    Option 2: Use launch mode: web-to-api --browser-mode launch'));
            console.log('');
          }
        } else {
          // Chrome not running at all — auto-launch with CDP + dedicated profile
          console.log(chalk.gray('  … Chrome not running, launching with debug port...'));

          const launched = await launchChromeWithCDP(cdpPort, chromeProfileDir, proxy);
          if (launched) {
            console.log(chalk.green('  ✓') + ` Chrome launched with CDP at port ${cdpPort}`);
            console.log(chalk.gray(`    Profile: ${chromeProfileDir}`));
          } else {
            console.log(chalk.yellow('  ⚠ Could not auto-launch Chrome with debug port.'));
            console.log(chalk.yellow('    Please start manually:'));
            console.log(chalk.cyan(`    ${getChromeCommand(cdpPort, chromeProfileDir, proxy)}`));
            console.log(chalk.yellow('    Or restart with: npm run dev -- --browser-mode launch'));
            console.log('');
          }
        }
      }

      if (!(await checkCDP(cdpUrl))) {
        console.log(chalk.yellow('  ⚠ CDP unavailable — auto-switching to launch mode'));
        browserMode = 'launch';
      }
    } else {
      console.log(chalk.green('  ✓') + ' Browser mode: launch (independent Chrome)');
    }

    if (browserMode === 'launch') {
      const chromePath = findChromePath();
      console.log(chalk.green('  ✓') + ` Browser: ${chalk.cyan(chromePath ?? 'not found')} (managed by Playwright)`);
    }

    const browserManager = new BrowserManager({
      profileDir: chromeProfileDir,
      startupTimeout: config.browser.startupTimeout,
      idleShutdown: config.browser.idleShutdown,
      loginTimeout: config.browser.loginTimeout,
      cdpUrl,
      mode: browserMode,
      proxy,
    });

    // ── Step 4: Register providers ──
    const registry = new ProviderRegistry();
    const authStore = new AuthStore(stateDir);

    const browserFetch = (url: string, init: RequestInit) =>
      browserManager.fetchInBrowser(url, init);
    const getPage = (origin: string) =>
      browserManager.getPageForOrigin(origin);

    // Providers that need getPage for multi-step browser-context API calls
    const NEEDS_GET_PAGE = new Set(['deepseek-web', 'qwen-web', 'kimi-web']);

    const enabled = new Set(config.providers.enabled);
    for (const [id, Ctor] of Object.entries(PROVIDER_MAP)) {
      if (enabled.has(id)) {
        if (NEEDS_GET_PAGE.has(id)) {
          registry.register(new Ctor(authStore, browserFetch, getPage));
        } else {
          registry.register(new Ctor(authStore, browserFetch));
        }
      }
    }

    // ── Step 4b: Auto-detect authenticated providers via cookies ──
    if (browserMode === 'attach' && await checkCDP(cdpUrl)) {
      try {
        const detected = await browserManager.autoDetectAuth();
        let autoAuthCount = 0;
        for (const [providerId, hasCookies] of Object.entries(detected)) {
          if (hasCookies && enabled.has(providerId)) {
            authStore.setStatus(providerId, 'active');
            autoAuthCount++;
          }
        }
        if (autoAuthCount > 0) {
          console.log(chalk.green('  ✓') + ` Auto-detected ${autoAuthCount} authenticated providers from browser cookies`);
        }
      } catch {
        // Auto-detect failed, not critical
      }
    }

    // ── Step 4c: Import session JSON from ~/.web-to-api/imports ──
    const importsPath = defaultImportsSourceDir(stateDir);
    const pendingImports = findImportCandidates(importsPath);
    if (pendingImports.length > 0) {
      console.log(chalk.gray(`  … Importing ${pendingImports.length} session file(s) from ${importsPath}`));
      try {
        const importResults = await importSessionsFromDir(
          importsPath,
          state => browserManager.importBrowserState(state),
          providerId => authStore.setStatus(providerId, 'active'),
        );
        const ok = importResults.filter(r => r.status === 'imported').length;
        const failed = importResults.filter(r => r.status === 'error').length;
        if (ok > 0) {
          console.log(chalk.green('  ✓') + ` Imported sessions for ${ok} provider(s)`);
        }
        if (failed > 0) {
          console.log(chalk.yellow(`  ⚠ ${failed} import(s) failed — check JSON format`));
        }
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Session import failed: ${(err as Error).message}`));
      }
    }

    // ── Step 5: Create and start server ──
    const telegramNotifier = new MutableErrorNotifier();
    const reloadTelegramNotifier = () => {
      const runtime = loadRuntimeSettings(stateDir);
      telegramNotifier.set(createTelegramErrorNotifier(mergeTelegramSettings(runtime.telegram, process.env)));
    };
    reloadTelegramNotifier();

    const app = createApp({
      registry,
      authStore,
      authToken: config.server.authToken,
      stateDir,
      logFilePath: getLogFilePath() ?? config.logging.file,
      errorNotifier: telegramNotifier,
      reloadTelegramNotifier,
      getBrowserStatus: () => browserManager.getStatus(),
      importBrowserState: (state) => browserManager.importBrowserState(state),
      onLogin: async (providerId: string) => {
        const provider = registry.getProvider(providerId);
        if (!provider) return { status: 'error', message: `Provider "${providerId}" not found.` };

        await browserManager.startLogin(providerId, provider.info.loginUrl, (success) => {
          if (success) {
            authStore.setStatus(providerId, 'active');
            console.log(chalk.green(`  ✓ ${providerId} login completed. Cookies saved.`));
          } else {
            console.log(chalk.yellow(`  ⚠ ${providerId} login did not complete.`));
          }
        });

        return {
          status: 'login_started',
          message: browserMode === 'attach'
            ? 'A new tab opened in your Chrome. Log in and close the tab when done.'
            : 'A Chrome window opened. Log in and close it when done.',
        };
      },
      getLoginState: () => browserManager.getLoginState(),
    });

    serve({
      fetch: app.fetch,
      port: serverPort,
      hostname: serverHost,
    });

    const url = `http://${serverHost === '0.0.0.0' ? 'localhost' : serverHost}:${serverPort}`;

    console.log(chalk.green('  ✓') + ` Server running at ${chalk.cyan(url)}`);
    console.log(chalk.green('  ✓') + ` API Base: ${chalk.cyan(url + '/v1')}`);

    const providerStatuses = await registry.providerStatus();
    const authCount = providerStatuses.filter(p => p.authenticated).length;
    console.log(chalk.green('  ✓') + ` ${providerStatuses.length} providers, ${authCount} authenticated`);

    if (opts.open !== false && config.server.openDashboard) {
      console.log(chalk.green('  ✓') + ` Dashboard: ${chalk.cyan(url)} (opening in browser)`);
      await open(url);
    } else {
      console.log(chalk.green('  ✓') + ` Dashboard: ${chalk.cyan(url)}`);
    }

    if (authCount === 0 && browserMode === 'attach') {
      const cdpNow = await checkCDP(cdpUrl);
      if (cdpNow) {
        console.log('');
        console.log(chalk.green('  ✓ Chrome is connected. Your existing login sessions are available.'));
        console.log(chalk.gray('    Requests will use cookies from your Chrome browser.'));
      }
    }

    console.log('');
    console.log(chalk.gray('  Press Ctrl+C to stop'));
    console.log('');

    process.on('SIGINT', async () => {
      console.log(chalk.gray('\n  Shutting down...'));
      await browserManager.shutdown();
      process.exit(0);
    });
  });

program
  .command('install-service')
  .description('Register as system service (launchd/systemd)')
  .option('--service-name <name>', 'systemd user service name', DEFAULT_SERVICE_NAME)
  .option('--port <port>', 'listen port', '3456')
  .option('--host <host>', 'bind address', '127.0.0.1')
  .option('--state-dir <dir>', 'state directory', DEFAULT_STATE_DIR)
  .option('--chrome-profile <dir>', 'Chrome user data directory')
  .option('--proxy-server <url>', 'HTTP proxy for Chrome')
  .option('--proxy-user <user>', 'proxy login')
  .option('--proxy-pass <pass>', 'proxy password')
  .option('--auth-token <token>', 'Bridge API bearer token')
  .option('--telegram-bot-token <token>', 'Telegram bot token for API error alerts')
  .option('--telegram-chat-id <id>', 'Telegram chat/user id for API error alerts')
  .option('--telegram-api-base <url>', 'Telegram Bot API base URL')
  .option('--enable-now', 'run daemon-reload, enable and restart service now')
  .action((opts) => {
    installSystemdUserService(opts);
  });

program
  .command('uninstall-service')
  .description('Uninstall system service')
  .option('--service-name <name>', 'systemd user service name', DEFAULT_SERVICE_NAME)
  .option('--remove-env', 'also remove ~/.config/web-to-api/env')
  .action((opts) => {
    uninstallSystemdUserService(opts);
  });

program.parse();

function resolveCliPath(): string {
  return fileURLToPath(import.meta.url);
}

function normalizeServiceName(name: string | undefined): string {
  return String(name || DEFAULT_SERVICE_NAME).replace(/\.service$/, '');
}

function installSystemdUserService(opts: any): void {
  if (platform() !== 'linux') {
    console.log(chalk.red('  systemd user service install is supported on Linux only.'));
    process.exit(1);
  }

  const serviceName = normalizeServiceName(opts.serviceName);
  const cliPath = resolveCliPath();
  if (!existsSync(cliPath)) {
    console.log(chalk.red(`  CLI not found: ${cliPath}`));
    process.exit(1);
  }

  const stateDir = opts.stateDir || DEFAULT_STATE_DIR;

  mkdirSync(DEFAULT_SERVICE_ENV_DIR, { recursive: true });
  mkdirSync(DEFAULT_SYSTEMD_USER_DIR, { recursive: true });

  const envValues: Record<string, string | undefined> = {
    DISPLAY: process.env.DISPLAY || ':99',
    WTA_PORT: String(opts.port || '3456'),
    WTA_HOST: opts.host || '127.0.0.1',
    WTA_STATE_DIR: stateDir,
    WTA_AUTH_TOKEN: opts.authToken || process.env.WTA_AUTH_TOKEN,
    WTA_PROXY_SERVER: opts.proxyServer || process.env.WTA_PROXY_SERVER,
    WTA_PROXY_USER: opts.proxyUser || process.env.WTA_PROXY_USER,
    WTA_PROXY_PASS: opts.proxyPass || process.env.WTA_PROXY_PASS,
    WTA_TELEGRAM_BOT_TOKEN: opts.telegramBotToken || process.env.WTA_TELEGRAM_BOT_TOKEN,
    WTA_TELEGRAM_CHAT_ID: opts.telegramChatId || process.env.WTA_TELEGRAM_CHAT_ID,
    WTA_TELEGRAM_API_BASE: opts.telegramApiBase || process.env.WTA_TELEGRAM_API_BASE,
  };

  writeFileSync(DEFAULT_SERVICE_ENV_FILE, renderEnvironmentFile(envValues), { mode: 0o600 });

  const servicePath = join(DEFAULT_SYSTEMD_USER_DIR, `${serviceName}.service`);
  const execStart = [
    process.execPath,
    cliPath,
    '--no-open',
    '--browser-mode',
    'launch',
    '--port',
    String(opts.port || '3456'),
    '--host',
    opts.host || '127.0.0.1',
    '--state-dir',
    stateDir,
    '--chrome-profile',
    opts.chromeProfile || defaultChromeProfileDir(),
  ].map(systemdEscapeArg).join(' ');

  writeFileSync(servicePath, `[Unit]
Description=Web-to-API Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${stateDir}
EnvironmentFile=${DEFAULT_SERVICE_ENV_FILE}
ExecStart=${execStart}
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=30

[Install]
WantedBy=default.target
`);

  console.log(chalk.green('  ✓') + ` Wrote ${servicePath}`);
  console.log(chalk.green('  ✓') + ` Wrote ${DEFAULT_SERVICE_ENV_FILE}`);
  console.log(chalk.gray(`  CLI: ${cliPath}`));
  console.log(chalk.gray(`  Start manually: systemctl --user daemon-reload && systemctl --user enable --now ${serviceName}.service`));

  if (opts.enableNow) {
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync(`systemctl --user enable --now ${serviceName}.service`, { stdio: 'inherit' });
    console.log(chalk.green('  ✓') + ` Service ${serviceName}.service enabled and restarted`);
  }
}

function uninstallSystemdUserService(opts: { serviceName?: string; removeEnv?: boolean }): void {
  if (platform() !== 'linux') {
    console.log(chalk.red('  systemd user service uninstall is supported on Linux only.'));
    process.exit(1);
  }

  const serviceName = normalizeServiceName(opts.serviceName);
  const unitName = `${serviceName}.service`;
  const servicePath = join(DEFAULT_SYSTEMD_USER_DIR, `${serviceName}.service`);

  if (existsSync(servicePath)) {
    try {
      execSync(`systemctl --user stop ${unitName}`, { stdio: 'ignore' });
    } catch {
      // Service may already be stopped.
    }
    try {
      execSync(`systemctl --user disable ${unitName}`, { stdio: 'ignore' });
    } catch {
      // Unit may not be enabled.
    }
    unlinkSync(servicePath);
    console.log(chalk.green('  ✓') + ` Removed ${servicePath}`);
  } else {
    console.log(chalk.yellow(`  Service unit not found: ${servicePath}`));
  }

  if (opts.removeEnv) {
    if (existsSync(DEFAULT_SERVICE_ENV_FILE)) {
      unlinkSync(DEFAULT_SERVICE_ENV_FILE);
      console.log(chalk.green('  ✓') + ` Removed ${DEFAULT_SERVICE_ENV_FILE}`);
    } else {
      console.log(chalk.yellow(`  Env file not found: ${DEFAULT_SERVICE_ENV_FILE}`));
    }
  }

  execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
  console.log(chalk.green('  ✓') + ` Uninstalled ${unitName}`);
}

function renderEnvironmentFile(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => `${key}=${quoteEnvValue(value!)}`)
    .join('\n') + '\n';
}

function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function systemdEscapeArg(value: string): string {
  return value.includes(' ') ? `"${value.replace(/"/g, '\\"')}"` : value;
}
