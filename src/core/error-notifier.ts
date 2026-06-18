// ======Settings=========
const TELEGRAM_MIN_REPEAT_MS = Number(process.env.WTA_TELEGRAM_MIN_REPEAT_MS || 30000);
const TELEGRAM_MAX_MESSAGE_CHARS = 3500;
// ======Settings=========

export interface ApiErrorEvent {
  route: string;
  model?: string;
  provider?: string;
  message: string;
  status?: number;
  runId?: string;
}

export interface ErrorNotifier {
  notify(event: ApiErrorEvent): Promise<void>;
}

export type { TelegramSettings } from './runtime-settings.js';
import type { TelegramSettings } from './runtime-settings.js';
import { proxyDisplayLabel } from '../config/proxy.js';
import { resolveTelegramProxy, sendTelegramBotMessage } from './telegram-bot-api.js';

export interface TelegramSettingsView {
  configured: boolean;
  botTokenMasked: string | null;
  chatId: string | null;
  proxy: {
    server: string;
    username: string | null;
    passwordMasked: string | null;
    label: string;
  } | null;
  envLocked: {
    botToken: boolean;
    chatId: boolean;
    proxy: boolean;
  };
}

export class MutableErrorNotifier implements ErrorNotifier {
  private inner: ErrorNotifier | null = null;

  set(inner: ErrorNotifier | null): void {
    this.inner = inner;
  }

  get(): ErrorNotifier | null {
    return this.inner;
  }

  async notify(event: ApiErrorEvent): Promise<void> {
    await this.inner?.notify(event);
  }
}

export function mergeTelegramSettings(
  persisted: TelegramSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): TelegramSettings | null {
  const botToken = pick(env.WTA_TELEGRAM_BOT_TOKEN, persisted?.botToken);
  const chatId = pick(env.WTA_TELEGRAM_CHAT_ID, persisted?.chatId);
  if (!botToken || !chatId) return null;

  const proxy = resolveTelegramProxy(persisted, env);
  return {
    botToken,
    chatId,
    proxy: proxy ?? undefined,
  };
}

export function createTelegramErrorNotifierFromEnv(): ErrorNotifier | null {
  return createTelegramErrorNotifier(mergeTelegramSettings(undefined, process.env));
}

export function createTelegramErrorNotifier(config: TelegramSettings | null): ErrorNotifier | null {
  if (!config?.botToken || !config.chatId) return null;
  return new TelegramErrorNotifier(config);
}

export function buildTelegramSettingsView(
  persisted: TelegramSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): TelegramSettingsView {
  const merged = mergeTelegramSettings(persisted, env);
  const draft: TelegramSettings = {
    ...persisted,
    botToken: pick(env.WTA_TELEGRAM_BOT_TOKEN, persisted?.botToken),
    chatId: pick(env.WTA_TELEGRAM_CHAT_ID, persisted?.chatId),
    proxy: resolveTelegramProxy(persisted, env) ?? undefined,
  };

  const proxy = draft.proxy ?? null;
  return {
    configured: Boolean(merged),
    botTokenMasked: draft.botToken ? maskSecret(draft.botToken) : null,
    chatId: draft.chatId ?? null,
    proxy: proxy
      ? {
          server: proxy.server,
          username: proxy.username ?? null,
          passwordMasked: proxy.password ? maskSecret(proxy.password) : null,
          label: proxyDisplayLabel(proxy),
        }
      : null,
    envLocked: {
      botToken: Boolean(env.WTA_TELEGRAM_BOT_TOKEN),
      chatId: Boolean(env.WTA_TELEGRAM_CHAT_ID),
      proxy: Boolean(env.WTA_TELEGRAM_PROXY_SERVER),
    },
  };
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function pick(envValue: string | undefined, storedValue: string | undefined): string | undefined {
  const fromEnv = envValue?.trim();
  if (fromEnv) return fromEnv;
  const fromStore = storedValue?.trim();
  return fromStore || undefined;
}

class TelegramErrorNotifier implements ErrorNotifier {
  private lastSent = new Map<string, number>();

  constructor(private config: TelegramSettings) {}

  async notify(event: ApiErrorEvent): Promise<void> {
    const key = `${event.route}:${event.model || ''}:${event.provider || ''}:${event.message}`;
    const now = Date.now();
    const last = this.lastSent.get(key) || 0;
    if (now - last < TELEGRAM_MIN_REPEAT_MS) return;
    this.lastSent.set(key, now);

    const text = formatTelegramError(event);
    try {
      await sendTelegramBotMessage(
        this.config.botToken!,
        this.config.chatId!,
        text,
        this.config,
      );
    } catch {
      // Notifications must never break the API request path.
    }
  }
}

function formatTelegramError(event: ApiErrorEvent): string {
  const lines = [
    'web-to-api error',
    `route: ${event.route}`,
    event.status ? `status: ${event.status}` : '',
    event.model ? `model: ${event.model}` : '',
    event.provider ? `provider: ${event.provider}` : '',
    event.runId ? `runId: ${event.runId}` : '',
    `message: ${event.message}`,
  ].filter(Boolean);
  return lines.join('\n').slice(0, TELEGRAM_MAX_MESSAGE_CHARS);
}
