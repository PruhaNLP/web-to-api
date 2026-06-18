import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../../src/core/registry.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import { InvalidModelError } from '../../../src/core/errors.js';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;
  let claude: MockProvider;
  let deepseek: MockProvider;

  beforeEach(() => {
    registry = new ProviderRegistry();
    claude = new MockProvider('claude-web', {
      authenticated: true,
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxOutput: 8192 },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutput: 8192 },
      ],
    });
    deepseek = new MockProvider('deepseek-web', {
      authenticated: false,
      models: [
        { id: 'deepseek-v4', name: 'DeepSeek V4', contextWindow: 128000, maxOutput: 8192 },
      ],
    });
    registry.register(claude);
    registry.register(deepseek);
  });

  it('resolves provider from model ID', async () => {
    const result = await registry.resolve('claude-web/claude-sonnet-4-6');
    expect(result.provider).toBe(claude);
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('resolves provider with different model', async () => {
    const result = await registry.resolve('deepseek-web/deepseek-v4');
    expect(result.provider).toBe(deepseek);
    expect(result.model).toBe('deepseek-v4');
  });

  it('throws InvalidModelError for unknown provider', async () => {
    await expect(registry.resolve('unknown/model')).rejects.toThrow(InvalidModelError);
  });

  it('resolves model without provider prefix via fuzzy match', async () => {
    const result = await registry.resolve('deepseek-v4');
    expect(result.provider).toBe(deepseek);
    expect(result.model).toBe('deepseek-v4');
  });

  it('resolves model without slash via fuzzy match', async () => {
    const result = await registry.resolve('claude-sonnet-4-6');
    expect(result.provider).toBe(claude);
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('throws InvalidModelError for completely unknown model', async () => {
    await expect(registry.resolve('nonexistent-model')).rejects.toThrow(InvalidModelError);
  });

  it('throws InvalidModelError for empty string', async () => {
    await expect(registry.resolve('')).rejects.toThrow(InvalidModelError);
  });

  it('allModels aggregates from all authenticated providers', async () => {
    const models = await registry.allModels();
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('claude-web/claude-sonnet-4-6');
    expect(models[1].id).toBe('claude-web/claude-haiku-4-5');
  });

  it('providerStatus returns status for all providers', async () => {
    const statuses = await registry.providerStatus();
    expect(statuses).toHaveLength(2);
    expect(statuses.find(s => s.id === 'claude-web')?.authenticated).toBe(true);
    expect(statuses.find(s => s.id === 'deepseek-web')?.authenticated).toBe(false);
  });
});
