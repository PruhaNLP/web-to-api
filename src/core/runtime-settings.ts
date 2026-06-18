import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProxySettings } from '../config/proxy.js';
import { parseProxySettings } from '../config/proxy.js';

// ======Settings=========
const RUNTIME_SETTINGS_FILE = 'settings.json';
// ======Settings=========

export interface TelegramSettings {
  botToken?: string;
  chatId?: string;
  proxy?: ProxySettings | null;
}

export interface RuntimeSettings {
  autoModelOrder?: string[];
  telegram?: TelegramSettings;
}

export function runtimeSettingsPath(stateDir: string): string {
  return join(stateDir, RUNTIME_SETTINGS_FILE);
}

export function loadRuntimeSettings(stateDir: string): RuntimeSettings {
  const filePath = runtimeSettingsPath(stateDir);
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const telegram = normalizeTelegramSettings(parsed.telegram);
    return {
      autoModelOrder: Array.isArray(parsed.autoModelOrder)
        ? parsed.autoModelOrder.filter((item: unknown) => typeof item === 'string')
        : undefined,
      telegram,
    };
  } catch {
    return {};
  }
}

export function saveRuntimeSettings(stateDir: string, settings: RuntimeSettings): void {
  const filePath = runtimeSettingsPath(stateDir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

function normalizeTelegramSettings(raw: unknown): TelegramSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: TelegramSettings = {};
  if (typeof obj.botToken === 'string' && obj.botToken.trim()) out.botToken = obj.botToken.trim();
  if (typeof obj.chatId === 'string' && obj.chatId.trim()) out.chatId = obj.chatId.trim();

  if (obj.proxy && typeof obj.proxy === 'object') {
    const p = obj.proxy as Record<string, unknown>;
    out.proxy = parseProxySettings({
      server: typeof p.server === 'string' ? p.server : undefined,
      username: typeof p.username === 'string' ? p.username : undefined,
      password: typeof p.password === 'string' ? p.password : undefined,
    });
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
