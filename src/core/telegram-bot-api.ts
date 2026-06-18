import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { ProxySettings } from '../config/proxy.js';
import { parseProxySettings, proxyDisplayLabel } from '../config/proxy.js';
import type { TelegramSettings } from './runtime-settings.js';

// ======Settings=========
export const DEFAULT_TELEGRAM_BOT_API = 'https://api.telegram.org';
const BOT_API_TIMEOUT_MS = 12_000;
// ======Settings=========

export interface TelegramBotInfo {
  id: number;
  username?: string;
  firstName?: string;
}

export interface TelegramChatCandidate {
  id: string;
  title: string;
  type: string;
  username?: string;
}

export interface TelegramBotApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
}

export function resolveTelegramProxy(
  settings: TelegramSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProxySettings | null {
  const fromEnv = parseProxySettings({
    server: env.WTA_TELEGRAM_PROXY_SERVER,
    username: env.WTA_TELEGRAM_PROXY_USER,
    password: env.WTA_TELEGRAM_PROXY_PASS,
  });
  if (fromEnv) return fromEnv;
  return settings?.proxy ?? null;
}

export function parseTelegramProxyFromBody(
  body: {
    proxyServer?: string;
    proxyUser?: string;
    proxyPass?: string;
  },
  persisted?: ProxySettings | null,
): ProxySettings | null | undefined {
  const touched = body.proxyServer !== undefined
    || body.proxyUser !== undefined
    || body.proxyPass !== undefined;
  if (!touched) return undefined;

  const server = body.proxyServer !== undefined
    ? body.proxyServer.trim()
    : (persisted?.server ?? '');
  if (!server) return null;

  const username = body.proxyUser !== undefined
    ? body.proxyUser.trim()
    : persisted?.username;
  let password: string | undefined;
  if (body.proxyPass !== undefined) {
    password = body.proxyPass.trim() ? body.proxyPass : persisted?.password;
  } else {
    password = persisted?.password;
  }

  return parseProxySettings({
    server,
    username: username || undefined,
    password: password || undefined,
  });
}

export async function verifyTelegramBotToken(
  token: string,
  settings: TelegramSettings | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<TelegramBotInfo> {
  const data = await callBotApi<Record<string, unknown>>(token, 'getMe', {}, settings, env);
  const result = data.result;
  if (!result || result.id == null) {
    throw new Error('Invalid getMe response');
  }
  return {
    id: Number(result.id),
    username: typeof result.username === 'string' ? result.username : undefined,
    firstName: typeof result.first_name === 'string' ? result.first_name : undefined,
  };
}

export async function discoverTelegramChatIds(
  token: string,
  settings: TelegramSettings | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<{ chats: TelegramChatCandidate[]; consumedUpdates: number }> {
  await callBotApi(token, 'deleteWebhook', { drop_pending_updates: false }, settings, env).catch(() => {});

  const data = await callBotApi<Array<Record<string, unknown>>>(token, 'getUpdates', {
    limit: 50,
    timeout: 0,
  }, settings, env);

  const updates = Array.isArray(data.result) ? data.result : [];
  const chats = new Map<string, TelegramChatCandidate>();

  for (const update of updates) {
    const message = (update.message || update.edited_message || update.channel_post) as Record<string, unknown> | undefined;
    const chat = message?.chat as Record<string, unknown> | undefined;
    if (!chat || chat.id == null) continue;
    const id = String(chat.id);
    if (chats.has(id)) continue;
    chats.set(id, {
      id,
      type: String(chat.type || 'unknown'),
      title: String(chat.title || chat.first_name || chat.username || id),
      username: chat.username ? String(chat.username) : undefined,
    });
  }

  return { chats: [...chats.values()], consumedUpdates: updates.length };
}

export async function sendTelegramBotMessage(
  token: string,
  chatId: string,
  text: string,
  settings: TelegramSettings | undefined,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await callBotApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  }, settings, env);
}

async function callBotApi<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  settings?: TelegramSettings,
  env?: NodeJS.ProcessEnv,
): Promise<TelegramBotApiResponse<T>> {
  const url = `${DEFAULT_TELEGRAM_BOT_API}/bot${token}/${method}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_API_TIMEOUT_MS);
  const proxy = resolveTelegramProxy(settings, env);

  try {
    const res = await botApiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    }, proxy);
    const data = await res.json() as TelegramBotApiResponse<T>;
    if (!data.ok) {
      throw new Error(data.description || `Telegram Bot API ${method} failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (proxy && err instanceof Error && /fetch failed|abort|ECONNREFUSED/i.test(err.message)) {
      throw new Error(`${err.message} (via proxy ${proxyDisplayLabel(proxy)})`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function botApiFetch(
  url: string,
  init: RequestInit,
  proxy: ProxySettings | null,
): Promise<Response> {
  if (!proxy) {
    return fetch(url, init);
  }

  const agent = new ProxyAgent(buildProxyAgentUrl(proxy));
  try {
    return await undiciFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string>,
      body: init.body as string,
      signal: init.signal ?? undefined,
      dispatcher: agent,
    }) as unknown as Response;
  } finally {
    await agent.close();
  }
}

function buildProxyAgentUrl(proxy: ProxySettings): string {
  const base = proxy.server.includes('://') ? proxy.server : `http://${proxy.server}`;
  const url = new URL(base);
  if (proxy.username) {
    url.username = encodeURIComponent(proxy.username);
    if (proxy.password) url.password = encodeURIComponent(proxy.password);
  }
  return url.toString();
}

export function resolveTelegramToken(
  override: string | undefined,
  settings: TelegramSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromBody = override?.trim();
  if (fromBody) return fromBody;
  const fromEnv = env.WTA_TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return settings?.botToken?.trim() || undefined;
}
