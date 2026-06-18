import { describe, it, expect } from 'vitest';
import {
  formatStreamChunk,
  formatDoneChunk,
  formatNonStreamResponse,
  formatModelsResponse,
  formatStreamUsageChunk,
} from '../../../src/core/openai-formatter.js';
import type { StreamEvent } from '../../../src/core/stream.js';
import type { ModelInfo } from '../../../src/core/provider.js';

describe('OpenAI Formatter', () => {
  const modelId = 'claude-web/claude-sonnet-4-6';

  describe('formatStreamChunk', () => {
    it('formats text_delta as chat.completion.chunk', () => {
      const event: StreamEvent = { type: 'text_delta', delta: 'Hello' };
      const chunk = formatStreamChunk('run-1', modelId, event, false);
      expect(chunk.id).toBe('run-1');
      expect(chunk.object).toBe('chat.completion.chunk');
      expect(chunk.model).toBe(modelId);
      expect(chunk.choices[0].index).toBe(0);
      expect(chunk.choices[0].delta.content).toBe('Hello');
      expect(chunk.choices[0].finish_reason).toBeNull();
    });

    it('first chunk includes role', () => {
      const event: StreamEvent = { type: 'text_delta', delta: 'Hi' };
      const chunk = formatStreamChunk('run-1', modelId, event, true);
      expect(chunk.choices[0].delta.role).toBe('assistant');
      expect(chunk.choices[0].delta.content).toBe('Hi');
    });

    it('non-first chunk omits role', () => {
      const event: StreamEvent = { type: 'text_delta', delta: 'Hi' };
      const chunk = formatStreamChunk('run-1', modelId, event, false);
      expect(chunk.choices[0].delta).not.toHaveProperty('role');
    });

    it('formats done with finish_reason stop', () => {
      const event: StreamEvent = { type: 'done', reason: 'stop' };
      const chunk = formatStreamChunk('run-1', modelId, event, false);
      expect(chunk.choices[0].finish_reason).toBe('stop');
      expect(chunk.choices[0].delta).toEqual({});
    });

    it('formats done with finish_reason length', () => {
      const event: StreamEvent = { type: 'done', reason: 'length' };
      const chunk = formatStreamChunk('run-1', modelId, event, false);
      expect(chunk.choices[0].finish_reason).toBe('length');
    });

    it('formats done with tool_use as tool_calls', () => {
      const event: StreamEvent = { type: 'done', reason: 'tool_use' };
      const chunk = formatStreamChunk('run-1', modelId, event, false);
      expect(chunk.choices[0].finish_reason).toBe('tool_calls');
    });

    it('formats thinking_delta as reasoning_content', () => {
      const event: StreamEvent = { type: 'thinking_delta', delta: 'Thinking...' };
      const chunk = formatStreamChunk('run-1', modelId, event, true);
      expect(chunk.choices[0].delta.role).toBe('assistant');
      expect(chunk.choices[0].delta.reasoning_content).toBe('Thinking...');
      expect(chunk.choices[0].delta).not.toHaveProperty('content');
    });
  });

  describe('formatDoneChunk', () => {
    it('returns [DONE] string', () => {
      expect(formatDoneChunk()).toBe('[DONE]');
    });
  });

  describe('formatStreamUsageChunk', () => {
    it('returns usage-only final stream chunk', () => {
      const chunk = formatStreamUsageChunk('run-1', modelId, 1200, 300);
      expect(chunk.choices).toEqual([]);
      expect(chunk.usage).toEqual({
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        estimated_context_tokens: 1200,
      });
    });
  });

  describe('formatNonStreamResponse', () => {
    it('formats complete response', () => {
      const res = formatNonStreamResponse('run-1', modelId, 'Hello world');
      expect(res.id).toBe('run-1');
      expect(res.object).toBe('chat.completion');
      expect(res.model).toBe(modelId);
      expect(res.choices[0].message.role).toBe('assistant');
      expect(res.choices[0].message.content).toBe('Hello world');
      expect(res.choices[0].finish_reason).toBe('stop');
    });

    it('formats reasoning_content separately', () => {
      const res = formatNonStreamResponse('run-1', modelId, 'Answer', 'Reasoning');
      expect(res.choices[0].message.content).toBe('Answer');
      expect(res.choices[0].message.reasoning_content).toBe('Reasoning');
    });
  });

  describe('formatModelsResponse', () => {
    it('formats model list', () => {
      const models: (ModelInfo & { id: string })[] = [
        { id: 'claude-web/claude-sonnet-4-6', name: 'Claude Sonnet', contextWindow: 200000, maxOutput: 8192 },
        { id: 'deepseek-web/deepseek-v4', name: 'DeepSeek V4', contextWindow: 128000, maxOutput: 8192 },
      ];
      const res = formatModelsResponse(models);
      expect(res.object).toBe('list');
      expect(res.data).toHaveLength(2);
      expect(res.data[0].id).toBe('claude-web/claude-sonnet-4-6');
      expect(res.data[0].object).toBe('model');
      expect(res.data[0].owned_by).toBe('web-to-api');
    });
  });
});
