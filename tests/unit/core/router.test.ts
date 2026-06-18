import { describe, it, expect, beforeEach } from 'vitest';
import { Router } from '../../../src/core/router.js';
import { ProviderRegistry } from '../../../src/core/registry.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import { BaseProvider, type ProviderInfo, type ModelInfo, type ChatRequest } from '../../../src/core/provider.js';
import type { StreamEvent } from '../../../src/core/stream.js';

class FailingProvider extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'failing',
    name: 'Failing',
    website: 'https://fail.example.com',
    loginUrl: 'https://fail.example.com/login',
    needsBrowser: false,
  };
  constructor(private failCount: number) { super(); }
  async login(_context: { openUrl: (url: string) => Promise<void> }): Promise<void> {}
  async isAuthenticated(): Promise<boolean> { return true; }
  async detectLoginComplete(): Promise<boolean> { return true; }
  async models(): Promise<ModelInfo[]> {
    return [{ id: 'fail-model', name: 'Fail', contextWindow: 1000, maxOutput: 100 }];
  }
  private attempts = 0;
  async *chat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    this.attempts++;
    if (this.attempts <= this.failCount) {
      yield { type: 'error', message: 'Provider failed' };
      return;
    }
    yield { type: 'text_delta', delta: 'Recovered!' };
    yield { type: 'done', reason: 'stop' };
  }
}

describe('Router', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('routes to primary provider on success', async () => {
    const primary = new MockProvider('claude-web', { authenticated: true });
    registry.register(primary);
    const router = new Router(registry);

    const events: StreamEvent[] = [];
    for await (const e of router.chat('claude-web/mock-model-1', {
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })) {
      events.push(e);
    }
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
  });

  it('falls back when primary is not authenticated', async () => {
    const primary = new MockProvider('claude-web', { authenticated: false });
    const fallback = new MockProvider('deepseek-web', { authenticated: true });
    registry.register(primary);
    registry.register(fallback);

    const router = new Router(registry, {
      fallbacks: { 'claude-web': ['deepseek-web'] },
    });

    const events: StreamEvent[] = [];
    for await (const e of router.chat('claude-web/model', {
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })) {
      events.push(e);
    }
    expect(events.some(e => e.type === 'text_delta' && e.delta.includes('deepseek-web'))).toBe(true);
  });

  it('retries on error then succeeds', async () => {
    const failing = new FailingProvider(1); // Fail once, then succeed
    registry.register(failing);
    const router = new Router(registry, { maxRetries: 2 });

    const events: StreamEvent[] = [];
    for await (const e of router.chat('failing/fail-model', {
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })) {
      events.push(e);
    }
    expect(events.some(e => e.type === 'text_delta' && e.delta === 'Recovered!')).toBe(true);
  });

  it('exhausts retries and falls back', async () => {
    const failing = new FailingProvider(999); // Always fails
    const fallback = new MockProvider('backup', { authenticated: true });
    registry.register(failing);
    registry.register(fallback);

    const router = new Router(registry, {
      fallbacks: { 'failing': ['backup'] },
      maxRetries: 0, // No retries, go straight to fallback
    });

    const events: StreamEvent[] = [];
    for await (const e of router.chat('failing/fail-model', {
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })) {
      events.push(e);
    }
    expect(events.some(e => e.type === 'text_delta' && e.delta.includes('backup'))).toBe(true);
  });

  it('returns error when all attempts fail', async () => {
    const failing = new FailingProvider(999);
    registry.register(failing);
    const router = new Router(registry, { maxRetries: 0 });

    const events: StreamEvent[] = [];
    for await (const e of router.chat('failing/fail-model', {
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    })) {
      events.push(e);
    }
    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});
