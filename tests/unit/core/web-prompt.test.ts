import { describe, it, expect } from 'vitest';
import { buildWebPrompt, extractText } from '../../../src/core/provider.js';
import type { Message } from '../../../src/core/provider.js';

describe('buildWebPrompt', () => {
  it('extracts plain user message', () => {
    const messages: Message[] = [
      { role: 'user', content: '你好' },
    ];
    expect(buildWebPrompt(messages)).toBe('你好');
  });

  it('keeps system messages as standing instructions', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful coding assistant.' },
      { role: 'user', content: '你好' },
    ];
    const prompt = buildWebPrompt(messages);
    expect(prompt).toContain('<system_instructions>\nYou are a helpful coding assistant.\n</system_instructions>');
    expect(prompt).toContain('你好');
  });

  it('strips agent-framework timestamp prefix from user message', () => {
    const messages: Message[] = [
      { role: 'user', content: '[Mon 2026-04-06 21:46 GMT+8] 王者荣耀是哪个公司的？' },
    ];
    expect(buildWebPrompt(messages)).toBe('王者荣耀是哪个公司的？');
  });

  it('strips agent-framework session startup boilerplate', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are an AI agent with tools...' },
      {
        role: 'user',
        content: `A new session was started via /new or /reset. Run your Session Startup sequence.
Current time: Monday, April 6th, 2026 — 21:46 (Asia/Shanghai) / 2026-04-06 13:46 UTC
Sender (untrusted metadata):
\`\`\`json
{
  "label": "control-ui",
  "id": "control-ui"
}
\`\`\`

[Mon 2026-04-06 21:46 GMT+8] 王者荣耀是哪个公司的？你是哪个公司的？`,
      },
    ];
    const prompt = buildWebPrompt(messages);
    expect(prompt).toContain('You are an AI agent with tools...');
    expect(prompt).toContain('王者荣耀是哪个公司的？你是哪个公司的？');
  });

  it('packs multi-turn conversation context into one explicit prompt', () => {
    const messages: Message[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮你的？' },
      { role: 'user', content: '天气怎么样？' },
    ];
    const prompt = buildWebPrompt(messages);
    expect(prompt).toContain('whole conversation context inside this single message');
    expect(prompt).toContain('### Turn 1: User\n你好');
    expect(prompt).toContain('### Turn 2: Assistant\n你好！有什么可以帮你的？');
    expect(prompt).toContain('### Turn 3: User\n天气怎么样？');
    expect(prompt).toContain('Latest user message:\n天气怎么样？');
  });

  it('handles content block array format', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: '你好' }] as any },
    ];
    expect(buildWebPrompt(messages)).toBe('你好');
  });

  it('passes through plain message without framework metadata', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Tell me about JavaScript' },
    ];
    expect(buildWebPrompt(messages)).toBe('Tell me about JavaScript');
  });

  it('keeps tool role messages as context', () => {
    const messages: Message[] = [
      { role: 'user', content: '搜索天气' },
      { role: 'tool', content: '{"result": "晴天"}', tool_call_id: '123' },
      { role: 'user', content: '谢谢' },
    ];
    const prompt = buildWebPrompt(messages);
    expect(prompt).toContain('### Turn 1: User\n搜索天气');
    expect(prompt).toContain('### Turn 2: Tool result\ntool_call_id=123\n{"result": "晴天"}');
    expect(prompt).toContain('Latest user message:\n谢谢');
  });

  it('keeps assistant tool calls in conversation context', () => {
    const messages: Message[] = [
      { role: 'user', content: '搜索天气' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'search', arguments: '{"query":"weather"}' },
        }],
      },
      { role: 'tool', content: '{"result":"晴天"}', tool_call_id: 'call_1' },
      { role: 'user', content: '谢谢' },
    ];
    const prompt = buildWebPrompt(messages);
    expect(prompt).toContain('{"tool_calls":[{"name":"search","arguments":{"query":"weather"}}]}');
    expect(prompt).toContain('tool_call_id=call_1');
    expect(prompt).toContain('{"result":"晴天"}');
    expect(prompt).toContain('Latest user message:\n谢谢');
  });

  it('returns empty string for empty messages', () => {
    expect(buildWebPrompt([])).toBe('');
  });

  it('handles different day names in timestamp', () => {
    const messages: Message[] = [
      { role: 'user', content: '[Tue 2026-04-07 09:30 Asia/Shanghai] 早上好' },
    ];
    expect(buildWebPrompt(messages)).toBe('早上好');
  });

  it('does not include prior assistant reasoning in context', () => {
    const messages: Message[] = [
      { role: 'user', content: 'explain this' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Long hidden reasoning that must not bloat context' },
          { type: 'text', text: 'Final answer only' },
        ] as any,
        reasoning_content: 'Also ignored reasoning field',
      },
      { role: 'user', content: 'continue' },
    ];
    const prompt = buildWebPrompt(messages);
    expect(prompt).toContain('Final answer only');
    expect(prompt).not.toContain('Long hidden reasoning');
    expect(prompt).not.toContain('Also ignored reasoning');
  });
});

describe('extractText', () => {
  it('returns string as-is', () => {
    expect(extractText('hello')).toBe('hello');
  });

  it('extracts text from content block array', () => {
    expect(extractText([{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }])).toBe('hello world');
  });

  it('handles non-string non-array', () => {
    expect(extractText(123)).toBe('123');
  });

  it('handles null/undefined', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
  });
});
