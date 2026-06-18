import type { StreamEvent } from './stream.js';
import type { ModelInfo } from './provider.js';
import type { OpenAIToolCall } from './openai-features.js';

// ======Settings=========
const TOKEN_ESTIMATE_PER_CHAR = 2.5;
// ======Settings=========

interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_context_tokens?: number;
  };
}

export function formatStreamChunk(
  runId: string,
  modelId: string,
  event: StreamEvent,
  isFirst: boolean,
): ChatCompletionChunk {
  const base: ChatCompletionChunk = {
    id: runId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: null }],
  };

  if (event.type === 'text_delta') {
    base.choices[0].delta = isFirst
      ? { role: 'assistant', content: event.delta }
      : { content: event.delta };
  } else if (event.type === 'done') {
    const reason = event.reason === 'tool_use' ? 'tool_calls' : event.reason;
    base.choices[0].finish_reason = reason;
    base.choices[0].delta = {};
  } else if (event.type === 'thinking_delta') {
    base.choices[0].delta = isFirst
      ? { role: 'assistant', reasoning_content: event.delta }
      : { reasoning_content: event.delta };
  } else if (event.type === 'error') {
    base.choices[0].delta = isFirst
      ? { role: 'assistant', content: event.message }
      : { content: event.message };
  }

  return base;
}

export function formatDoneChunk(): string {
  return '[DONE]';
}

export function formatStreamUsageChunk(
  runId: string,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): ChatCompletionChunk {
  return {
    id: runId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated_context_tokens: promptTokens,
    },
  };
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length * TOKEN_ESTIMATE_PER_CHAR);
}

interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      reasoning_content?: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_context_tokens: number;
  };
}

export function formatNonStreamResponse(
  runId: string,
  modelId: string,
  content: string,
  reasoningContent = '',
  contextTokens = 0,
): ChatCompletion {
  const message: ChatCompletion['choices'][number]['message'] = { role: 'assistant', content };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  const completionTokens = estimateTextTokens(`${content}${reasoningContent}`);

  return {
    id: runId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message,
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: contextTokens,
      completion_tokens: completionTokens,
      total_tokens: contextTokens + completionTokens,
      estimated_context_tokens: contextTokens,
    },
  };
}

export function formatNonStreamToolCallResponse(
  runId: string,
  modelId: string,
  toolCalls: OpenAIToolCall[],
  contextTokens = 0,
): ChatCompletion {
  const completionTokens = estimateTextTokens(JSON.stringify(toolCalls));
  return {
    id: runId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: null, tool_calls: toolCalls },
      finish_reason: 'tool_calls',
    }],
    usage: {
      prompt_tokens: contextTokens,
      completion_tokens: completionTokens,
      total_tokens: contextTokens + completionTokens,
      estimated_context_tokens: contextTokens,
    },
  };
}

export function formatToolCallStreamChunks(
  runId: string,
  modelId: string,
  toolCalls: OpenAIToolCall[],
): ChatCompletionChunk[] {
  const created = Math.floor(Date.now() / 1000);
  const start: ChatCompletionChunk = {
    id: runId,
    object: 'chat.completion.chunk',
    created,
    model: modelId,
    choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }],
  };
  const chunks = toolCalls.map((call, index): ChatCompletionChunk => ({
    id: runId,
    object: 'chat.completion.chunk',
    created,
    model: modelId,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index,
          id: call.id,
          type: call.type,
          function: call.function,
        }],
      },
      finish_reason: null,
    }],
  }));
  const done: ChatCompletionChunk = {
    id: runId,
    object: 'chat.completion.chunk',
    created,
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  };
  return [start, ...chunks, done];
}

interface ModelsResponse {
  object: 'list';
  data: Array<{
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
  }>;
}

export function formatModelsResponse(
  models: (ModelInfo & { id: string })[],
): ModelsResponse {
  const now = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model' as const,
      created: now,
      owned_by: 'web-to-api',
    })),
  };
}
