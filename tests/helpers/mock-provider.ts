import { BaseProvider, type ProviderInfo, type ModelInfo, type ChatRequest } from '../../src/core/provider.js';
import type { StreamEvent } from '../../src/core/stream.js';

export class MockProvider extends BaseProvider {
  readonly info: ProviderInfo;
  private _authenticated: boolean;
  private _models: ModelInfo[];
  private _responseText: string | null;

  constructor(
    id: string,
    opts?: { authenticated?: boolean; models?: ModelInfo[]; responseText?: string }
  ) {
    super();
    this.info = {
      id,
      name: `Mock ${id}`,
      website: `https://${id}.example.com`,
      loginUrl: `https://${id}.example.com/login`,
      needsBrowser: true,
    };
    this._authenticated = opts?.authenticated ?? true;
    this._models = opts?.models ?? [
      { id: 'mock-model-1', name: 'Mock Model 1', contextWindow: 100000, maxOutput: 4096 },
    ];
    this._responseText = opts?.responseText ?? null;
  }

  async login(): Promise<void> {
    this._authenticated = true;
  }

  async isAuthenticated(): Promise<boolean> {
    return this._authenticated;
  }

  async detectLoginComplete(): Promise<boolean> {
    return this._authenticated;
  }

  async models(): Promise<ModelInfo[]> {
    return this._models;
  }

  async *chat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    yield { type: 'text_delta', delta: this._responseText ?? `Hello from ${this.info.id}` };
    yield { type: 'done', reason: 'stop' };
  }
}
