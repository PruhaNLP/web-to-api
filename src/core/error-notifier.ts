// ======Settings=========
const TELEGRAM_API_BASE = process.env.WTA_TELEGRAM_API_BASE || 'https://api.telegram.org';
const TELEGRAM_TIMEOUT_MS = Number(process.env.WTA_TELEGRAM_TIMEOUT_MS || 5000);
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

export function createTelegramErrorNotifierFromEnv(): ErrorNotifier | null {
  const token = process.env.WTA_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.WTA_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return new TelegramErrorNotifier(token, chatId);
}

class TelegramErrorNotifier implements ErrorNotifier {
  private lastSent = new Map<string, number>();

  constructor(
    private token: string,
    private chatId: string,
  ) {}

  async notify(event: ApiErrorEvent): Promise<void> {
    const key = `${event.route}:${event.model || ''}:${event.provider || ''}:${event.message}`;
    const now = Date.now();
    const last = this.lastSent.get(key) || 0;
    if (now - last < TELEGRAM_MIN_REPEAT_MS) return;
    this.lastSent.set(key, now);

    const text = formatTelegramError(event);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
    try {
      await fetch(`${TELEGRAM_API_BASE}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
    } catch {
      // Notifications must never break the API request path.
    } finally {
      clearTimeout(timeout);
    }
  }
}

function formatTelegramError(event: ApiErrorEvent): string {
  const lines = [
    'WebModel API error',
    `route: ${event.route}`,
    event.status ? `status: ${event.status}` : '',
    event.model ? `model: ${event.model}` : '',
    event.provider ? `provider: ${event.provider}` : '',
    event.runId ? `runId: ${event.runId}` : '',
    `message: ${event.message}`,
  ].filter(Boolean);
  return lines.join('\n').slice(0, TELEGRAM_MAX_MESSAGE_CHARS);
}
