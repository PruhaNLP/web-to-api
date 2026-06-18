import { ProviderRegistry } from './registry.js';
import type { ChatRequest } from './provider.js';
import type { StreamEvent } from './stream.js';
import { AuthRequiredError } from './errors.js';

export interface RouterConfig {
  fallbacks?: Record<string, string[]>;  // providerId → fallback providerIds
  maxRetries?: number;                    // default 2
}

export class Router {
  constructor(
    private registry: ProviderRegistry,
    private config: RouterConfig = {},
  ) {}

  async *chat(modelId: string, req: Omit<ChatRequest, 'model'>): AsyncIterable<StreamEvent> {
    const { provider, model } = await this.registry.resolve(modelId);
    const providerId = provider.info.id;

    // Build attempt list: primary + fallbacks
    const attempts = [{ provider, model, modelId }];
    const fallbackIds = this.config.fallbacks?.[providerId] ?? [];
    for (const fbId of fallbackIds) {
      const fbProvider = this.registry.getProvider(fbId);
      if (fbProvider) {
        // Use first model from fallback provider
        const fbModels = await fbProvider.models();
        if (fbModels.length > 0) {
          attempts.push({
            provider: fbProvider,
            model: fbModels[0].id,
            modelId: `${fbId}/${fbModels[0].id}`,
          });
        }
      }
    }

    const maxRetries = this.config.maxRetries ?? 2;
    let lastError: Error | null = null;

    for (const attempt of attempts) {
      if (!(await attempt.provider.isAuthenticated())) {
        console.log(`[Router] Skipping ${attempt.modelId}: Not authenticated`);
        lastError = new AuthRequiredError(attempt.provider.info.id);
        continue; // Try next fallback
      }

      for (let retry = 0; retry <= maxRetries; retry++) {
        try {
          if (retry > 0) {
            console.log(`[Router] Retrying ${attempt.modelId} (attempt ${retry + 1}/${maxRetries + 1})...`);
          } else {
            console.log(`[Router] Requesting ${attempt.modelId}...`);
          }
          const events: StreamEvent[] = [];
          let hasError = false;

          for await (const event of attempt.provider.chat({
            ...req,
            model: attempt.model,
            stream: req.stream ?? true,
          })) {
            if (event.type === 'error') {
              hasError = true;
              console.error(`[Router] ${attempt.modelId} error: ${event.message}`);
              lastError = new Error(event.message);
              break;
            }
            events.push(event);
          }

          if (!hasError) {
            // Success — yield all collected events
            if (retry > 0) console.log(`[Router] ${attempt.modelId} succeeded after ${retry} retries`);
            for (const event of events) {
              yield event;
            }
            return;
          }

          // Retry with backoff
          if (retry < maxRetries) {
            const delay = Math.pow(2, retry) * 1000;
            console.log(`[Router] Waiting ${delay}ms before retry...`);
            await new Promise(r => setTimeout(r, delay));
          }
        } catch (err) {
          console.error(`[Router] ${attempt.modelId} exception:`, err);
          lastError = err as Error;
          if (retry < maxRetries) {
            const delay = Math.pow(2, retry) * 1000;
            console.log(`[Router] Waiting ${delay}ms before retry...`);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
    }

    // All attempts exhausted
    yield { type: 'error', message: lastError?.message ?? 'All providers failed' };
  }
}
