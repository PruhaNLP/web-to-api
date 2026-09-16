import { BaseProvider, type ProviderInfo, type ModelInfo, type ChatRequest, buildWebPrompt } from '../../core/provider.js';
import type { StreamEvent } from '../../core/stream.js';
import { AuthStore } from '../../auth/store.js';
import type { Page } from 'playwright-core';
import { KIMI_WEB_BASE_URL } from './client.js';

// ======Settings=========
const KIMI_CONTEXT_WINDOW = 256000;
const KIMI_MAX_OUTPUT = 8192;
const KIMI_DEFAULT_SCENARIO = 'SCENARIO_K2D5';
const KIMI_CHAT_PATH = '/apiv2/kimi.gateway.chat.v1.ChatService/Chat';
const KIMI_REFRESH_URL = 'https://auth.kimi.ai/api/account.gateway.v1.AuthService/RefreshToken';
const KIMI_TOKEN_REFRESH_MARGIN_SEC = 60;

const KIMI_MODELS: ModelInfo[] = [
  { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: KIMI_CONTEXT_WINDOW, maxOutput: KIMI_MAX_OUTPUT },
  { id: 'kimi-k2.6-thinking', name: 'Kimi K2.6 Thinking', contextWindow: KIMI_CONTEXT_WINDOW, maxOutput: KIMI_MAX_OUTPUT },
];
// ======Settings=========

export class KimiProvider extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'kimi-web',
    name: 'Kimi Web',
    website: KIMI_WEB_BASE_URL,
    loginUrl: KIMI_WEB_BASE_URL,
    needsBrowser: true,
  };

  constructor(
    private authStore: AuthStore,
    private browserFetch?: (url: string, init: RequestInit) => Promise<Response>,
    private getPage?: (origin: string) => Promise<Page>,
  ) {
    super();
  }

  async login(context: { openUrl: (url: string) => Promise<void> }): Promise<void> {
    await context.openUrl(this.info.loginUrl);
  }

  async isAuthenticated(): Promise<boolean> {
    return this.authStore.getStatus(this.info.id).status === 'active';
  }

  async detectLoginComplete(): Promise<boolean> {
    return false;
  }

  async models(): Promise<ModelInfo[]> {
    return KIMI_MODELS;
  }

  async *chat(req: ChatRequest): AsyncIterable<StreamEvent> {
    if (!this.getPage && !this.browserFetch) {
      yield { type: 'error', message: 'Browser not connected' };
      return;
    }

    try {
      const page = this.getPage
        ? await this.getPage(KIMI_WEB_BASE_URL)
        : null;

      if (!page) {
        yield { type: 'error', message: 'Kimi requires getPage for Connect RPC calls' };
        return;
      }

      const prompt = buildWebPrompt(req.messages, req.featureInstruction);
      const mode = resolveKimiMode(req.model);
      let authToken: string;
      try {
        authToken = await resolveKimiAuthToken(page);
      } catch (err) {
        yield { type: 'error', message: (err as Error).message };
        return;
      }

      // Kimi uses Connect RPC protocol with binary framing
      const sseResult = await page.evaluate(async (args: {
        prompt: string;
        authToken: string;
        scenario: string;
        thinking: boolean;
        chatPath: string;
      }) => {
        try {
          // Build Connect RPC request body
          const payload = JSON.stringify({
            scenario: args.scenario,
            message: {
              role: 'user',
              blocks: [{
                message_id: '',
                text: { content: args.prompt },
              }],
              scenario: args.scenario,
            },
            options: { thinking: args.thinking },
            tools: [],
          });

          // Create binary framed payload (Connect RPC format)
          const encoder = new TextEncoder();
          const payloadBytes = encoder.encode(payload);
          const frame = new Uint8Array(5 + payloadBytes.length);
          frame[0] = 0x00; // frame type: data
          // 4-byte big-endian length
          const dv = new DataView(frame.buffer);
          dv.setUint32(1, payloadBytes.length);
          frame.set(payloadBytes, 5);

          const headers: Record<string, string> = {
            'Content-Type': 'application/connect+json',
            'Connect-Protocol-Version': '1',
            'Accept': '*/*',
            'X-Language': 'zh-CN',
            'X-Msh-Platform': 'web',
          };
          if (args.authToken) headers['Authorization'] = `Bearer ${args.authToken}`;

          const res = await fetch(args.chatPath, {
            method: 'POST',
            headers,
            body: frame,
            credentials: 'include',
          });

          if (!res.ok) {
            const text = await res.text();
            return { error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
          }

          // Read binary response
          const reader = res.body?.getReader();
          if (!reader) return { error: 'No response body' };

          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }

          // Concatenate and decode frames
          const total = chunks.reduce((acc, c) => acc + c.length, 0);
          const allBytes = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            allBytes.set(c, offset);
            offset += c.length;
          }

          // Parse Connect RPC frames
          const texts: string[] = [];
          let pos = 0;
          const dec = new TextDecoder();
          while (pos < allBytes.length) {
            if (pos + 5 > allBytes.length) break;
            const frameType = allBytes[pos];
            const view = new DataView(allBytes.buffer, allBytes.byteOffset + pos + 1, 4);
            const len = view.getUint32(0);
            pos += 5;
            if (pos + len > allBytes.length) break;
            const frameData = allBytes.slice(pos, pos + len);
            pos += len;

            if (frameType === 0x00) {
              texts.push(dec.decode(frameData));
            }
          }

          return { frames: texts };
        } catch (e: any) {
          return { error: e.message };
        }
      }, {
        prompt,
        authToken,
        scenario: mode.scenario,
        thinking: mode.thinking,
        chatPath: KIMI_CHAT_PATH,
      });

      if (sseResult.error) {
        yield { type: 'error', message: `Kimi API error: ${sseResult.error}` };
        return;
      }

      // Parse Kimi response frames
      for (const frame of sseResult.frames || []) {
        try {
          const parsed = JSON.parse(frame);
          if (parsed?.event === 'resp' && parsed?.text) {
            yield { type: 'text_delta', delta: parsed.text };
          } else if (parsed?.event === 'all_done' || parsed?.event === 'cmpl') {
            yield { type: 'done', reason: 'stop' };
          } else if (parsed?.delta?.content) {
            yield { type: 'text_delta', delta: parsed.delta.content };
          } else if (parsed?.result?.text) {
            yield { type: 'text_delta', delta: parsed.result.text };
          } else if (parsed?.block?.text?.content) {
            yield { type: 'text_delta', delta: parsed.block.text.content };
          } else if (parsed?.done) {
            yield { type: 'done', reason: 'stop' };
          }
        } catch {
          if (frame.length > 0 && !frame.startsWith('{')) {
            yield { type: 'text_delta', delta: frame };
          }
        }
      }
    } catch (err) {
      yield { type: 'error', message: `Kimi provider error: ${(err as Error).message}` };
    }
  }
}

async function resolveKimiAuthToken(page: Page): Promise<string> {
  const stored = await page.evaluate(() => ({
    access: localStorage.getItem('access_token') || '',
    refresh: localStorage.getItem('refresh_token') || '',
  })).catch(() => ({ access: '', refresh: '' }));

  if (!stored.refresh) {
    throw new Error('Kimi: paste refresh_token from kimi.ai. Access tokens are not accepted.');
  }
  if (stored.access && !isJwtExpired(stored.access, KIMI_TOKEN_REFRESH_MARGIN_SEC)) {
    return stored.access;
  }

  const refreshed = await page.evaluate(async (args: { refreshToken: string; refreshUrl: string }) => {
    try {
      const res = await fetch(args.refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify({ refresh_token: args.refreshToken }),
      });
      const text = await res.text();
      if (!res.ok) return { error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
      const data = JSON.parse(text);
      const access = data.access_token || data.accessToken || '';
      const refresh = data.refresh_token || data.refreshToken || args.refreshToken;
      if (!access) return { error: 'refresh returned no access_token' };
      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);
      return { access };
    } catch (e: any) {
      return { error: e.message };
    }
  }, { refreshToken: stored.refresh, refreshUrl: KIMI_REFRESH_URL });

  if (refreshed.access) return refreshed.access;
  throw new Error(`Kimi refresh failed: ${refreshed.error || 'unknown error'}`);
}

function isJwtExpired(token: string, marginSec: number): boolean {
  const parts = token.split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number') return false;
    return payload.exp <= Math.floor(Date.now() / 1000) + marginSec;
  } catch {
    return false;
  }
}

function resolveKimiMode(modelId: string): { scenario: string; thinking: boolean } {
  const thinking = modelId.toLowerCase().includes('thinking') || modelId.toLowerCase().includes('reasoner');
  return { scenario: KIMI_DEFAULT_SCENARIO, thinking };
}
