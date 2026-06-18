import { BaseProvider, type ProviderInfo, type ModelInfo, type ChatRequest, buildWebPrompt } from '../../core/provider.js';
import type { StreamEvent } from '../../core/stream.js';

import { solvePow, buildPowResponse, type DeepSeekPowChallenge } from './pow.js';
import { DEEPSEEK_WEB_BASE_URL } from './client.js';
import { AuthStore } from '../../auth/store.js';
import type { Page } from 'playwright-core';

// ======Settings=========
const DEEPSEEK_CONTEXT_WINDOW = 128000;
const DEEPSEEK_MAX_OUTPUT = 8192;

const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (Instant)', contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxOutput: DEEPSEEK_MAX_OUTPUT },
  { id: 'deepseek-v4-flash-reasoner', name: 'DeepSeek V4 Flash Reasoner (Instant + Thinking)', contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxOutput: DEEPSEEK_MAX_OUTPUT },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (Expert)', contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxOutput: DEEPSEEK_MAX_OUTPUT },
  { id: 'deepseek-v4-pro-reasoner', name: 'DeepSeek V4 Pro Reasoner (Expert + Thinking)', contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxOutput: DEEPSEEK_MAX_OUTPUT },
];

const DEEPSEEK_CLIENT_HEADERS: Record<string, string> = {
  'x-app-version': '2.0.0',
  'x-client-bundle-id': 'com.deepseek.chat',
  'x-client-locale': 'en_US',
  'x-client-platform': 'web',
  'x-client-timezone-offset': '0',
  'x-client-version': '2.0.0',
};
// ======Settings=========

export class DeepSeekProvider extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'deepseek-web',
    name: 'DeepSeek Web',
    website: DEEPSEEK_WEB_BASE_URL,
    loginUrl: `${DEEPSEEK_WEB_BASE_URL}/sign_in`,
    needsBrowser: true,
  };

  private bearerToken: string | null = null;

  constructor(
    private authStore: AuthStore,
    _browserFetch?: (url: string, init: RequestInit) => Promise<Response>,
    private getPage?: (origin: string) => Promise<Page>,
  ) {
    super();
  }

  /** Set a bearer token for API authentication (from browser session export). */
  setBearerToken(token: string): void {
    this.bearerToken = token;
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
    return DEEPSEEK_MODELS;
  }

  async *chat(req: ChatRequest): AsyncIterable<StreamEvent> {
    if (!this.getPage) {
      yield { type: 'error', message: 'Browser not connected' };
      return;
    }

    try {
      const page = await this.getPage(DEEPSEEK_WEB_BASE_URL);
      const mode = resolveDeepSeekMode(req.model);

      // Step 1: Extract bearer token
      // DeepSeek stores JWT in a cookie named "ds_chat_token" or via login response.
      // Strategy: try /api/v0/users/current with cookies → intercept from page.
      let bearer = this.bearerToken;
      if (!bearer) {
        // Primary method: Intercept request headers by reloading the page.
        // DeepSeek's frontend JS adds the Authorization header from its own state.
        const tokenPromise = new Promise<string | null>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 10000);
          const handler = (request: any) => {
            const url = request.url() as string;
            if (url.includes('/api/v0/')) {
              const auth = request.headers()['authorization'] as string | undefined;
              if (auth?.startsWith('Bearer ')) {
                clearTimeout(timeout);
                page.off('request', handler);
                resolve(auth.slice(7));
              }
            }
          };
          page.on('request', handler);
        });
        // Reload the page — DeepSeek frontend will fire API calls with Bearer token
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {});
        bearer = await tokenPromise;
        if (!bearer) {
          bearer = await page.evaluate(() => {
            const raw = localStorage.getItem('userToken') || localStorage.getItem('settingsJwt') || '';
            try {
              const parsed = JSON.parse(raw);
              const token = parsed?.value?.jwt || parsed?.value || raw;
              return token.startsWith('Bearer ') ? token.slice(7) : token;
            } catch {
              return raw.startsWith('Bearer ') ? raw.slice(7) : raw;
            }
          }).catch(() => '');
        }
      }
      if (!bearer) {
        yield { type: 'error', message: 'DeepSeek: could not extract bearer token. Please re-login at chat.deepseek.com' };
        return;
      }

      const hifLeim = await page.evaluate(() => {
        const raw = localStorage.getItem('hif_leim_cached') || '';
        try {
          const parsed = JSON.parse(raw);
          return typeof parsed === 'string' ? parsed : '';
        } catch {
          return raw.replace(/^"|"$/g, '');
        }
      }).catch(() => '');

      // Step 2: Create chat session
      const sessionResult = await page.evaluate(async (args: {
        bearerToken: string | null; modelType: string; clientHeaders: Record<string, string>;
      }) => {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json', ...args.clientHeaders };
          if (args.bearerToken) headers['Authorization'] = `Bearer ${args.bearerToken}`;
          const res = await fetch('/api/v0/chat_session/create', {
            method: 'POST',
            headers,
            body: JSON.stringify({ model_type: args.modelType }),
            credentials: 'include',
          });
          if (!res.ok) {
            const text = await res.text();
            return { error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
          }
          const data = await res.json();
          return {
            sessionId: data?.data?.biz_data?.chat_session?.id || data?.data?.biz_data?.id || data?.data?.id,
          };
        } catch (e: any) {
          return { error: e.message };
        }
      }, { bearerToken: bearer, modelType: mode.modelType, clientHeaders: DEEPSEEK_CLIENT_HEADERS });

      if (sessionResult.error || !sessionResult.sessionId) {
        yield { type: 'error', message: `DeepSeek session create failed: ${sessionResult.error || 'no session id'}` };
        return;
      }

      // Step 3: Get PoW challenge
      const challengeResult = await page.evaluate(async (args: {
        bearerToken: string | null; clientHeaders: Record<string, string>;
      }) => {
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json', ...args.clientHeaders };
          if (args.bearerToken) headers['Authorization'] = `Bearer ${args.bearerToken}`;
          const res = await fetch('/api/v0/chat/create_pow_challenge', {
            method: 'POST',
            headers,
            body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
            credentials: 'include',
          });
          if (!res.ok) return { error: `HTTP ${res.status}` };
          const data = await res.json();
          const c = data?.data?.biz_data?.challenge || data?.data?.challenge || data?.challenge;
          return { challenge: c };
        } catch (e: any) {
          return { error: e.message };
        }
      }, { bearerToken: bearer, clientHeaders: DEEPSEEK_CLIENT_HEADERS });

      if (challengeResult.error || !challengeResult.challenge) {
        yield { type: 'error', message: `DeepSeek PoW challenge failed: ${challengeResult.error || 'no challenge'}` };
        return;
      }

      // Step 4: Solve PoW (runs in Node.js, not browser)
      const challenge = challengeResult.challenge as DeepSeekPowChallenge;
      let powResponse: string;
      try {
        const answer = await solvePow(challenge);
        powResponse = buildPowResponse(challenge, answer, '/api/v0/chat/completion');
      } catch (err) {
        yield { type: 'error', message: `DeepSeek PoW solve failed: ${(err as Error).message}` };
        return;
      }

      // Step 5: Build prompt
      const prompt = buildWebPrompt(req.messages, req.featureInstruction);

      // Step 6: Send message with PoW header, read SSE
      const sseResult = await page.evaluate(async (args: {
        sessionId: string; prompt: string; powResponse: string; thinkingEnabled: boolean; modelType: string; bearerToken: string | null;
        clientHeaders: Record<string, string>; hifLeim: string;
      }) => {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...args.clientHeaders,
            'x-ds-pow-response': args.powResponse,
          };
          if (args.bearerToken) headers['Authorization'] = `Bearer ${args.bearerToken}`;
          if (args.hifLeim) headers['x-hif-leim'] = args.hifLeim;
          const res = await fetch('/api/v0/chat/completion', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              chat_session_id: args.sessionId,
              parent_message_id: null,
              prompt: args.prompt,
              ref_file_ids: [],
              model_type: args.modelType,
              thinking_enabled: args.thinkingEnabled,
              search_enabled: false,
              action: null,
              preempt: false,
            }),
            credentials: 'include',
          });

          if (!res.ok) {
            const text = await res.text();
            return { error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
          }

          const reader = res.body?.getReader();
          if (!reader) return { error: 'No response body' };

          const decoder = new TextDecoder();
          let fullText = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullText += decoder.decode(value, { stream: true });
          }
          return { data: fullText };
        } catch (e: any) {
          return { error: e.message };
        }
      }, {
        sessionId: sessionResult.sessionId,
        prompt,
        powResponse,
        thinkingEnabled: mode.thinkingEnabled,
        modelType: mode.modelType,
        bearerToken: bearer,
        clientHeaders: DEEPSEEK_CLIENT_HEADERS,
        hifLeim,
      });

      if (sseResult.error) {
        yield { type: 'error', message: `DeepSeek API error: ${sseResult.error}` };
        return;
      }

      // Step 7: Parse SSE
      // DeepSeek Web uses a JSON-patch SSE format:
      //   {"p":"response/content","o":"APPEND","v":"Hello"} — append to content
      //   {"v":"!"} — short form append (continues previous path)
      //   {"p":"response/status","v":"FINISHED"} — status update
      //   {"p":"response/thinking_content","o":"APPEND","v":"..."} — thinking
      const lines = (sseResult.data ?? '').split('\n');
      let lastPath = '';
      let emittedContent = false;
      let emittedThinking = false;
      let fallbackContent = '';
      let fallbackThinking = '';
      let doneReason: 'stop' | null = null;
      let eventName = '';
      let lastFragmentType = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('event:')) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith('data: ')) continue;

        const raw = trimmed.slice(6);
        if (raw === '[DONE]' || raw === '{}') continue;

        try {
          const parsed = JSON.parse(raw);

          if (eventName === 'toast' && parsed?.type === 'error') {
            yield { type: 'error', message: `DeepSeek: ${parsed.content || parsed.finish_reason || 'model error'}` };
            return;
          }

          // Some model modes emit only a full response state instead of APPEND patches.
          if (parsed?.v?.response) {
            const response = parsed.v.response;
            let initialContent = typeof response.content === 'string' ? response.content : '';
            const initialThinking = typeof response.thinking_content === 'string' ? response.thinking_content : '';
            if (!initialContent && Array.isArray(response.fragments)) {
              initialContent = response.fragments
                .filter((fragment: any) => fragment?.type === 'RESPONSE' && typeof fragment?.content === 'string')
                .map((fragment: any) => fragment.content)
                .join('');
            }
            const fragmentThinking = Array.isArray(response.fragments)
              ? response.fragments
                .filter((fragment: any) => fragment?.type === 'THINK' && typeof fragment?.content === 'string')
                .map((fragment: any) => fragment.content)
                .join('')
              : '';
            const thinking = initialThinking || fragmentThinking;
            const lastFragment = Array.isArray(response.fragments) ? response.fragments.at(-1) : null;
            if (typeof lastFragment?.type === 'string') lastFragmentType = lastFragment.type;
            if (thinking && !emittedThinking) {
              emittedThinking = true;
              yield { type: 'thinking_delta', delta: thinking };
            }
            if (initialContent && !emittedContent) {
              emittedContent = true;
              yield { type: 'text_delta', delta: initialContent };
            }
            fallbackContent = initialContent;
            fallbackThinking = thinking;
            continue;
          }

          const path = parsed.p ?? lastPath;
          if (parsed.p) lastPath = parsed.p;
          const value = parsed.v;

          if (path === 'response/fragments' && parsed.o === 'APPEND' && Array.isArray(value)) {
            for (const fragment of value) {
              if (typeof fragment?.type === 'string') lastFragmentType = fragment.type;
              if (fragment?.type === 'THINK' && typeof fragment?.content === 'string' && fragment.content.length > 0) {
                emittedThinking = true;
                yield { type: 'thinking_delta', delta: fragment.content };
              } else if (fragment?.type === 'RESPONSE' && typeof fragment?.content === 'string' && fragment.content.length > 0) {
                emittedContent = true;
                yield { type: 'text_delta', delta: fragment.content };
              }
            }
          } else if (path === 'response/fragments/-1/content' && typeof value === 'string' && value.length > 0) {
            if (lastFragmentType === 'THINK') {
              emittedThinking = true;
              yield { type: 'thinking_delta', delta: value };
            } else {
              emittedContent = true;
              yield { type: 'text_delta', delta: value };
            }
          } else if (path === 'response/content' && typeof value === 'string' && value.length > 0) {
            emittedContent = true;
            yield { type: 'text_delta', delta: value };
          } else if (path === 'response/thinking_content' && typeof value === 'string' && value.length > 0) {
            emittedThinking = true;
            yield { type: 'thinking_delta', delta: value };
          } else if (path === 'response/status' && (value === 'FINISHED' || value === 'DONE')) {
            doneReason = 'stop';
          }
        } catch {
          // Skip non-JSON lines
        }
      }
      if (!emittedThinking && fallbackThinking) {
        yield { type: 'thinking_delta', delta: fallbackThinking };
      }
      if (!emittedContent && fallbackContent) {
        yield { type: 'text_delta', delta: fallbackContent };
      }
      if (doneReason) {
        yield { type: 'done', reason: doneReason };
      }

    } catch (err) {
      yield { type: 'error', message: `DeepSeek provider error: ${(err as Error).message}` };
    }
  }
}

function resolveDeepSeekMode(modelId: string): { modelType: 'default' | 'expert'; thinkingEnabled: boolean } {
  const normalized = modelId.toLowerCase();
  const modelType = normalized.includes('expert') || normalized.includes('pro')
    ? 'expert'
    : 'default';
  const thinkingEnabled = normalized.includes('reasoner') || normalized.includes('thinking');
  return { modelType, thinkingEnabled };
}
