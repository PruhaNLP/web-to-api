import { resolve } from 'node:path';
import { defaultStateDir } from '../config/paths.js';
import {
  defaultImportsSourceDir,
  findImportCandidates,
} from '../session/import.js';

// ======Settings=========
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3456';
const DEFAULT_TIMEOUT_MS = 30_000;
// ======Settings=========

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--print-systemd')) {
    printSystemdUnits();
    return;
  }

  const stateDir = resolve(process.env.WTA_STATE_DIR || defaultStateDir());
  const bridgeUrl = normalizeBridgeUrl(process.env.WTA_COOKIE_BRIDGE_URL || DEFAULT_BRIDGE_URL);
  const sourceDir = resolve(process.env.WTA_IMPORTS_DIR || defaultImportsSourceDir(stateDir));
  const token = process.env.WTA_AUTH_TOKEN || process.env.WTA_COOKIE_AUTH_TOKEN || '';
  const timeoutMs = Number(process.env.WTA_COOKIE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  if (args.has('--status')) {
    await printStatus(bridgeUrl, token, timeoutMs);
    return;
  }

  const candidates = findImportCandidates(sourceDir);
  if (candidates.length === 0) {
    throw new Error(`No session files found in ${sourceDir}`);
  }

  console.log(`Imports dir: ${sourceDir}`);
  console.log(`Bridge: ${bridgeUrl}`);

  for (const candidate of candidates) {
    const result = await postJson(
      `${bridgeUrl}/admin/auth/import-state`,
      {
        providerId: candidate.providerId,
        state: candidate.state,
      },
      token,
      timeoutMs,
    );
    console.log(`${candidate.providerId}: imported ${candidate.fileName}`);
    console.log(JSON.stringify(result));
  }

  await printStatus(bridgeUrl, token, timeoutMs);
}

async function printStatus(bridgeUrl: string, token: string, timeoutMs: number): Promise<void> {
  const health = await getJson(`${bridgeUrl}/admin/health`, token, timeoutMs);
  console.log('Server health:');
  console.log(JSON.stringify(health, null, 2));
}

async function getJson(url: string, token: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: authHeaders(token),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url: string, body: unknown, token: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(token),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeBridgeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function printSystemdUnits(): void {
  const nodePath = process.execPath;
  const projectDir = resolve(process.cwd());
  const stateDir = defaultStateDir();
  const sourceDir = defaultImportsSourceDir(stateDir);
  console.log(`[Unit]
Description=Refresh web-to-api session imports
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${projectDir}
Environment=WTA_COOKIE_BRIDGE_URL=${DEFAULT_BRIDGE_URL}
Environment=WTA_STATE_DIR=${stateDir}
Environment=WTA_IMPORTS_DIR=${sourceDir}
ExecStart=${nodePath} --import tsx src/tools/cookie-refresh.ts
`);
  console.log(`[Unit]
Description=Run web-to-api session import periodically

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
