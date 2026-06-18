import { BaseProvider, type ProviderInfo, type ModelInfo, type ChatRequest } from '../../src/core/provider.js';
import type { StreamEvent } from '../../src/core/stream.js';

export class DelayedMockProvider extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'delayed-mock',
    name: 'Delayed Mock',
    website: 'https://example.com',
    loginUrl: 'https://example.com/login',
    needsBrowser: false,
  };

  constructor(private chunks: StreamEvent[], private delayMs = 0) {
    super();
  }

  async login(): Promise<void> {}
  async isAuthenticated(): Promise<boolean> { return true; }
  async detectLoginComplete(): Promise<boolean> { return true; }
  async models(): Promise<ModelInfo[]> {
    return [{ id: 'test-model', name: 'Test', contextWindow: 100000, maxOutput: 4096 }];
  }

  async *chat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    for (const chunk of this.chunks) {
      if (this.delayMs > 0) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
      yield chunk;
    }
  }
}
