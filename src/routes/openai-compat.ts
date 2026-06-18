import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { ProviderRegistry } from '../core/registry.js';
import {
  formatStreamChunk,
  formatDoneChunk,
  formatNonStreamResponse,
  formatNonStreamToolCallResponse,
  formatToolCallStreamChunks,
  formatModelsResponse,
  formatStreamUsageChunk,
  estimateTextTokens,
} from '../core/openai-formatter.js';
import { AuthRequiredError, InvalidBodyError, errorToHttpResponse } from '../core/errors.js';
import { estimateContextTokens, type Message } from '../core/provider.js';
import type { StreamEvent } from '../core/stream.js';
import type { ErrorNotifier } from '../core/error-notifier.js';
import {
  buildOpenAIFeatureInstruction,
  hasPseudoFeatures,
  parseAssistantOutput,
} from '../core/openai-features.js';
import { AUTO_MODEL_ID, getAutoModelOrder } from '../core/auto-model-order.js';

// ======Settings=========
const AUTO_MODEL_CONTEXT_WINDOW = 1_000_000;
const AUTO_MODEL_MAX_OUTPUT = 8192;
// ======Settings=========

export function openaiRoutes(registry: ProviderRegistry, errorNotifier: ErrorNotifier | null = null): Hono {
  const app = new Hono();

  app.post('/v1/chat/completions', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      const res = errorToHttpResponse(new InvalidBodyError('invalid JSON'));
      return c.json(res.body, res.status as any);
    }

    if (!body.model || typeof body.model !== 'string') {
      const res = errorToHttpResponse(new InvalidBodyError('missing model field'));
      return c.json(res.body, res.status as any);
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      const res = errorToHttpResponse(new InvalidBodyError('missing messages field'));
      return c.json(res.body, res.status as any);
    }

    const runId = `wmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const featureOpts = {
      tools: Array.isArray(body.tools) ? body.tools : undefined,
      toolChoice: body.tool_choice,
      responseFormat: body.response_format,
    };
    const pseudoFeatures = hasPseudoFeatures(featureOpts);
    const featureInstruction = buildOpenAIFeatureInstruction(featureOpts);
    const messages: Message[] = body.messages;
    const contextTokens = estimateContextTokens(messages, featureInstruction);
    const isStream = body.stream === true;
    const isAuto = body.model === AUTO_MODEL_ID;

    if (isAuto) {
      const response = await runAutoNonStreamCompletion(registry, runId, messages, featureOpts, pseudoFeatures, featureInstruction, contextTokens);
      if ('error' in response) {
        notifyApiError(errorNotifier, {
          route: '/v1/chat/completions',
          model: body.model,
          status: 502,
          runId,
          message: response.error.message,
        });
        return c.json({ error: response.error }, 502 as any);
      }
      if (isStream) {
        c.header('Content-Type', 'text/event-stream');
        c.header('Cache-Control', 'no-cache');
        c.header('Connection', 'keep-alive');
        return stream(c, async (s) => {
          await writeNonStreamBodyAsSse(s, runId, response.body, contextTokens);
        });
      }
      return c.json(response.body);
    }

    let resolved;
    try {
      resolved = await registry.resolve(body.model);
    } catch (err) {
      const res = errorToHttpResponse(err as Error);
      return c.json(res.body, res.status as any);
    }

    const { provider, model } = resolved;

    if (!(await provider.isAuthenticated())) {
      const res = errorToHttpResponse(new AuthRequiredError(provider.info.id));
      return c.json(res.body, res.status as any);
    }

    if (isStream) {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return stream(c, async (s) => {
        if (pseudoFeatures) {
          let fullContent = '';
          let fullReasoning = '';
          let lastError: string | null = null;
          try {
            for await (const event of provider.chat({ model, messages, stream: false, tools: featureOpts.tools, featureInstruction })) {
              if (event.type === 'text_delta') {
                fullContent += event.delta;
              } else if (event.type === 'thinking_delta') {
                fullReasoning += event.delta;
              } else if (event.type === 'error') {
                lastError = event.message;
              }
            }
            if (fullContent.length === 0 && lastError) {
              notifyApiError(errorNotifier, {
                route: '/v1/chat/completions',
                model: body.model,
                provider: provider.info.id,
                status: 502,
                runId,
                message: lastError,
              });
              const errEvent: StreamEvent = { type: 'error', message: lastError };
              const chunk = formatStreamChunk(runId, body.model, errEvent, false);
              await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
              await s.write(`data: ${formatDoneChunk()}\n\n`);
              return;
            }
            let parsed = parseAssistantOutput(fullContent, featureOpts);
            if (parsed.type === 'error' && fullReasoning) {
              parsed = parseAssistantOutput(fullReasoning, featureOpts);
            }
            if (parsed.type === 'tool_calls') {
              for (const chunk of formatToolCallStreamChunks(runId, body.model, parsed.toolCalls)) {
                await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
              await writeStreamUsage(s, runId, body.model, contextTokens, estimateTextTokens(JSON.stringify(parsed.toolCalls)));
            } else if (parsed.type === 'text') {
              const chunk = formatStreamChunk(runId, body.model, { type: 'text_delta', delta: parsed.content }, true);
              await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
              if (fullReasoning) {
                const reasoningChunk = formatStreamChunk(runId, body.model, { type: 'thinking_delta', delta: fullReasoning }, false);
                await s.write(`data: ${JSON.stringify(reasoningChunk)}\n\n`);
              }
              const done = formatStreamChunk(runId, body.model, { type: 'done', reason: 'stop' }, false);
              await s.write(`data: ${JSON.stringify(done)}\n\n`);
              await writeStreamUsage(s, runId, body.model, contextTokens, estimateTextTokens(`${parsed.content}${fullReasoning}`));
            } else {
              notifyApiError(errorNotifier, {
                route: '/v1/chat/completions',
                model: body.model,
                provider: provider.info.id,
                status: 502,
                runId,
                message: parsed.message,
              });
              const errEvent: StreamEvent = { type: 'error', message: parsed.message };
              const chunk = formatStreamChunk(runId, body.model, errEvent, false);
              await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            await s.write(`data: ${formatDoneChunk()}\n\n`);
          } catch (err) {
            notifyApiError(errorNotifier, {
              route: '/v1/chat/completions',
              model: body.model,
              provider: provider.info.id,
              status: 502,
              runId,
              message: (err as Error).message,
            });
            const errEvent: StreamEvent = { type: 'error', message: (err as Error).message };
            const chunk = formatStreamChunk(runId, body.model, errEvent, false);
            await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
            await s.write(`data: ${formatDoneChunk()}\n\n`);
          }
          return;
        }

        let isFirst = true;
        let fullContent = '';
        let fullReasoning = '';
        try {
          for await (const event of provider.chat({ model, messages, stream: true, tools: featureOpts.tools, featureInstruction })) {
            if (event.type === 'text_delta') {
              fullContent += event.delta;
            } else if (event.type === 'thinking_delta') {
              fullReasoning += event.delta;
            }
            if (event.type === 'error') {
              notifyApiError(errorNotifier, {
                route: '/v1/chat/completions',
                model: body.model,
                provider: provider.info.id,
                status: 502,
                runId,
                message: event.message,
              });
            }
            const chunk = formatStreamChunk(runId, body.model, event, isFirst);
            await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
            isFirst = false;
          }
          await writeStreamUsage(s, runId, body.model, contextTokens, estimateTextTokens(`${fullContent}${fullReasoning}`));
          await s.write(`data: ${formatDoneChunk()}\n\n`);
        } catch (err) {
          notifyApiError(errorNotifier, {
            route: '/v1/chat/completions',
            model: body.model,
            provider: provider.info.id,
            status: 502,
            runId,
            message: (err as Error).message,
          });
          const errEvent: StreamEvent = {
            type: 'error',
            message: (err as Error).message,
          };
          const chunk = formatStreamChunk(runId, body.model, errEvent, false);
          await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
          await s.write(`data: ${formatDoneChunk()}\n\n`);
        }
      });
    }

    // Non-streaming
    const result = await runProviderNonStreamCompletion(provider, model, messages, featureOpts, featureInstruction);
    if (result.error) {
      notifyApiError(errorNotifier, {
        route: '/v1/chat/completions',
        model: body.model,
        provider: provider.info.id,
        status: 502,
        runId,
        message: result.error,
      });
      return c.json({
        error: { message: result.error, type: 'provider_error', code: 'provider_error' },
      }, 502 as any);
    }
    const rendered = renderNonStreamCompletion(runId, body.model, result.fullContent, result.fullReasoning, featureOpts, pseudoFeatures, contextTokens);
    if ('error' in rendered) {
      notifyApiError(errorNotifier, {
        route: '/v1/chat/completions',
        model: body.model,
        provider: provider.info.id,
        status: 502,
        runId,
        message: rendered.error.message,
      });
      return c.json({ error: rendered.error }, 502 as any);
    }
    return c.json(rendered.body);
  });

  app.get('/v1/models', async (c) => {
    const models = await registry.allModels();
    return c.json(formatModelsResponse(addAutoModel(sortModelsByLatency(models))));
  });

  return app;
}

function notifyApiError(errorNotifier: ErrorNotifier | null, event: {
  route: string;
  model?: string;
  provider?: string;
  message: string;
  status?: number;
  runId?: string;
}): void {
  if (!errorNotifier) return;
  void errorNotifier.notify(event);
}

async function runAutoNonStreamCompletion(
  registry: ProviderRegistry,
  runId: string,
  messages: Message[],
  featureOpts: { tools: any; toolChoice: any; responseFormat: any },
  pseudoFeatures: boolean,
  featureInstruction: string,
  contextTokens: number,
): Promise<{ body: unknown } | { error: { message: string; type: string; code: string } }> {
  const availableModels = new Set((await registry.allModels()).map(model => model.id));
  const errors: string[] = [];

  for (const modelId of getAutoModelOrder()) {
    if (!availableModels.has(modelId)) continue;

    try {
      const { provider, model } = await registry.resolve(modelId);
      if (!(await provider.isAuthenticated())) {
        errors.push(`${modelId}: not authenticated`);
        continue;
      }

      const result = await runProviderNonStreamCompletion(provider, model, messages, featureOpts, featureInstruction);
      if (result.error) {
        errors.push(`${modelId}: ${result.error}`);
        continue;
      }

      const rendered = renderNonStreamCompletion(runId, modelId, result.fullContent, result.fullReasoning, featureOpts, pseudoFeatures, contextTokens);
      if ('error' in rendered) {
        errors.push(`${modelId}: ${rendered.error.message}`);
        continue;
      }

      return rendered;
    } catch (err) {
      errors.push(`${modelId}: ${(err as Error).message}`);
    }
  }

  return {
    error: {
      message: `auto failed for all candidate models: ${errors.join('; ') || 'no candidates available'}`,
      type: 'provider_error',
      code: 'provider_error',
    },
  };
}

async function runProviderNonStreamCompletion(
  provider: any,
  model: string,
  messages: Message[],
  featureOpts: { tools: any },
  featureInstruction: string,
): Promise<{ fullContent: string; fullReasoning: string; error: string | null }> {
  let fullContent = '';
  let fullReasoning = '';
  let lastError: string | null = null;

  for await (const event of provider.chat({ model, messages, stream: false, tools: featureOpts.tools, featureInstruction })) {
    if (event.type === 'text_delta') {
      fullContent += event.delta;
    } else if (event.type === 'thinking_delta') {
      fullReasoning += event.delta;
    } else if (event.type === 'error') {
      lastError = event.message;
    }
  }

  return {
    fullContent,
    fullReasoning,
    error: fullContent.length === 0 && lastError ? lastError : null,
  };
}

function renderNonStreamCompletion(
  runId: string,
  modelId: string,
  fullContent: string,
  fullReasoning: string,
  featureOpts: { tools: any; toolChoice: any; responseFormat: any },
  pseudoFeatures: boolean,
  contextTokens: number,
): { body: unknown } | { error: { message: string; type: string; code: string } } {
  if (pseudoFeatures) {
    let parsed = parseAssistantOutput(fullContent, featureOpts);
    if (parsed.type === 'error' && fullReasoning) {
      parsed = parseAssistantOutput(fullReasoning, featureOpts);
    }
    if (parsed.type === 'tool_calls') {
      return { body: formatNonStreamToolCallResponse(runId, modelId, parsed.toolCalls, contextTokens) };
    }
    if (parsed.type === 'error') {
      return {
        error: { message: parsed.message, type: 'pseudo_feature_error', code: 'pseudo_feature_error' },
      };
    }
    return { body: formatNonStreamResponse(runId, modelId, parsed.content, fullReasoning, contextTokens) };
  }

  return { body: formatNonStreamResponse(runId, modelId, fullContent, fullReasoning, contextTokens) };
}

function sortModelsByLatency(models: Array<{ id: string }>): any[] {
  const order = new Map(getAutoModelOrder().map((id, index) => [id, index]));
  return [...models].sort((a, b) => {
    const aRank = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.id.localeCompare(b.id);
  });
}

function addAutoModel(models: any[]): any[] {
  return [{
    id: AUTO_MODEL_ID,
    name: 'Auto',
    contextWindow: AUTO_MODEL_CONTEXT_WINDOW,
    maxOutput: AUTO_MODEL_MAX_OUTPUT,
  }, ...models];
}

async function writeNonStreamBodyAsSse(s: any, runId: string, body: any, contextTokens = 0): Promise<void> {
  const modelId = typeof body?.model === 'string' ? body.model : AUTO_MODEL_ID;
  const choice = body?.choices?.[0];
  const message = choice?.message || {};

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const chunk of formatToolCallStreamChunks(runId, modelId, message.tool_calls)) {
      await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    const usage = body?.usage;
    const promptTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : contextTokens;
    const completionTokens = typeof usage?.completion_tokens === 'number'
      ? usage.completion_tokens
      : estimateTextTokens(JSON.stringify(message.tool_calls));
    await writeStreamUsage(s, runId, modelId, promptTokens, completionTokens);
    await s.write(`data: ${formatDoneChunk()}\n\n`);
    return;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  if (content) {
    const chunk = formatStreamChunk(runId, modelId, { type: 'text_delta', delta: content }, true);
    await s.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  if (reasoning) {
    const reasoningChunk = formatStreamChunk(runId, modelId, { type: 'thinking_delta', delta: reasoning }, !content);
    await s.write(`data: ${JSON.stringify(reasoningChunk)}\n\n`);
  }
  const done = formatStreamChunk(runId, modelId, { type: 'done', reason: 'stop' }, false);
  await s.write(`data: ${JSON.stringify(done)}\n\n`);
  const usage = body?.usage;
  const promptTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : contextTokens;
  const completionTokens = typeof usage?.completion_tokens === 'number'
    ? usage.completion_tokens
    : estimateTextTokens(`${content}${reasoning}`);
  await writeStreamUsage(s, runId, modelId, promptTokens, completionTokens);
  await s.write(`data: ${formatDoneChunk()}\n\n`);
}

async function writeStreamUsage(
  s: { write: (chunk: string) => Promise<unknown> },
  runId: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  const usageChunk = formatStreamUsageChunk(runId, modelId, promptTokens, completionTokens);
  await s.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
}
