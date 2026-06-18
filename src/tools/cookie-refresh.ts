import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// ======Settings=========
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3456';
const DEFAULT_TIMEOUT_MS = 30_000;
const PROVIDER_IMPORTS: Array<{ providerId: string; files: string[]; origin: string }> = [
  { providerId: 'deepseek-web', files: ['deepseek-state.json'], origin: 'https://chat.deepseek.com' },
  { providerId: 'kimi-web', files: ['kimi-state.json', 'kimi.json'], origin: 'https://www.kimi.com' },
  { providerId: 'qwen-web', files: ['qwen-state.json', 'qwen.json'], origin: 'https://chat.qwen.ai' },
];
// ======Settings=========

interface ImportState {
  url?: string;
  origin?: string;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookies?: string | Array<Record<string, unknown>>;
}

interface ImportCandidate {
  providerId: string;
  filePath: string;
  state: ImportState;
}

function defaultSourceDir(): string {
  return process.env.WTA_STATE_DIR || join(homedir(), '.web-to-api');
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--print-systemd')) {
    printSystemdUnits();
    return;
  }

  const bridgeUrl = normalizeBridgeUrl(process.env.WTA_COOKIE_BRIDGE_URL || DEFAULT_BRIDGE_URL);
  const sourceDir = resolve(process.env.WTA_COOKIE_SOURCE_DIR || defaultSourceDir());
  const token = process.env.WTA_AUTH_TOKEN || process.env.WTA_COOKIE_AUTH_TOKEN || '';
  const timeoutMs = Number(process.env.WTA_COOKIE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  if (args.has('--status')) {
    await printStatus(bridgeUrl, token, timeoutMs);
    return;
  }

  const candidates = loadCandidates(sourceDir);
  if (candidates.length === 0) {
    throw new Error(`No cookie state files found in ${sourceDir}`);
  }

  console.log(`Cookie refresh source: ${sourceDir}`);
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
    console.log(`${candidate.providerId}: imported ${candidate.filePath}`);
    console.log(JSON.stringify(result));
  }

  await printStatus(bridgeUrl, token, timeoutMs);
}

function loadCandidates(sourceDir: string): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  const imported = new Set<string>();

  for (const provider of PROVIDER_IMPORTS) {
    for (const fileName of provider.files) {
      const filePath = join(sourceDir, fileName);
      if (!existsSync(filePath)) continue;
      const key = `${provider.providerId}:${filePath}`;
      if (imported.has(key)) continue;
      imported.add(key);
      candidates.push({
        providerId: provider.providerId,
        filePath,
        state: normalizeStateFile(filePath, provider.origin),
      });
    }
  }

  return candidates;
}

function normalizeStateFile(filePath: string, fallbackOrigin: string): ImportState {
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

function normalizePlaywrightStorageState(state: any, fallbackOrigin: string): ImportState {
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
  const sourceDir = defaultSourceDir();
  console.log(`[Unit]
Description=Refresh web-to-api browser cookies
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${projectDir}
Environment=WTA_COOKIE_BRIDGE_URL=${DEFAULT_BRIDGE_URL}
Environment=WTA_COOKIE_SOURCE_DIR=${sourceDir}
ExecStart=${nodePath} --import tsx src/tools/cookie-refresh.ts
`);
  console.log(`[Unit]
Description=Run web-to-api cookie refresh periodically

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
