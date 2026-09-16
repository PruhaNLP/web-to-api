import type { StreamEvent } from './stream.js';

// ======Settings=========
const CONTEXT_PROMPT_HEADER = `You receive the whole conversation context inside this single message because the target web model does not receive separate OpenAI messages.
Treat the transcript below as prior conversation context. Do not answer older turns again. Use it only to understand references, decisions, tool results, and the user's current intent.
Answer only the latest user message at the end of the transcript.`;
const CONTEXT_TOKEN_MULTIPLIER = 2.5;
// ======Settings=========

export interface ProviderInfo {
  id: string;
  name: string;
  website: string;
  loginUrl: string;
  needsBrowser: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
}

export interface MessageToolCall {
  id?: string;
  type?: string;
  name?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  arguments?: unknown;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | unknown;
  tool_call_id?: string;
  tool_calls?: MessageToolCall[];
  reasoning_content?: string;
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  stream: boolean;
  tools?: ToolDef[];
  featureInstruction?: string;
  signal?: AbortSignal;
}

export abstract class BaseProvider {
  abstract readonly info: ProviderInfo;

  abstract login(context: { openUrl: (url: string) => Promise<void> }): Promise<void>;
  abstract isAuthenticated(): Promise<boolean>;
  abstract detectLoginComplete(): Promise<boolean>;
  abstract models(): Promise<ModelInfo[]>;
  abstract chat(req: ChatRequest): AsyncIterable<StreamEvent>;
}

export function extractText(content: string | unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
  }
  return String(content ?? '');
}

export function extractContextText(message: Pick<Message, 'role' | 'content' | 'reasoning_content'>): string {
  if (message.role === 'assistant') {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => block.text)
        .join('');
    }
    return extractText(message.content);
  }

  return extractText(message.content);
}

/**
 * Build a single prompt for web chat UIs from OpenAI-style messages.
 * System instructions stay as standing rules; assistant/tool turns become transcript context.
 */
export function buildWebPrompt(messages: Message[], featureInstruction = ''): string {
  const systemText = messages
    .filter(msg => msg.role === 'system')
    .map(msg => extractText(msg.content).trim())
    .filter(Boolean)
    .join('\n\n');
  const systemBlock = systemText
    ? `<system_instructions>\n${systemText}\n</system_instructions>\n\n`
    : '';

  const turns: Array<{ role: 'User' | 'Assistant' | 'Tool result'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const text = extractContextText(msg);

    if (msg.role === 'assistant') {
      const toolCalls = formatAssistantToolCalls(msg.tool_calls);
      const content = [text.trim(), toolCalls].filter(Boolean).join('\n');
      if (content) turns.push({ role: 'Assistant', content });
      continue;
    }

    if (!text) continue;

    if (msg.role === 'tool') {
      const prefix = msg.tool_call_id ? `tool_call_id=${msg.tool_call_id}\n` : '';
      turns.push({ role: 'Tool result', content: `${prefix}${text.trim()}` });
      continue;
    }

    const cleaned = stripClientMetadata(text);
    if (cleaned) {
      turns.push({ role: 'User', content: cleaned.trim() });
    }
  }

  const instructionBlock = featureInstruction
    ? `\n\n<available_tools_and_output_contract>\n${featureInstruction}\n</available_tools_and_output_contract>`
    : '';

  if (turns.length === 0) return `${systemBlock}${featureInstruction}`.trim();
  if (turns.length === 1 && turns[0].role === 'User') {
    return `${systemBlock}${turns[0].content}${instructionBlock}`.trim();
  }

  const latestUser = [...turns].reverse().find(turn => turn.role === 'User')?.content ?? turns[turns.length - 1].content;
  const transcript = turns
    .map((turn, index) => `### Turn ${index + 1}: ${turn.role}\n${turn.content}`)
    .join('\n\n');

  return `${systemBlock}${CONTEXT_PROMPT_HEADER}

<conversation_context>
${transcript}
</conversation_context>

Latest user message:
${latestUser}${instructionBlock}`;
}

function formatAssistantToolCalls(toolCalls: MessageToolCall[] | undefined): string {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';

  const calls = toolCalls
    .map((call) => {
      const name = call.function?.name ?? call.name ?? '';
      if (!name) return null;
      let args: unknown = call.function?.arguments ?? call.arguments ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          // Keep the raw argument string if it is not JSON.
        }
      }
      return { name, arguments: args };
    })
    .filter((call): call is { name: string; arguments: unknown } => call !== null);

  if (calls.length === 0) return '';
  return JSON.stringify({ tool_calls: calls });
}

export function estimateContextTokens(messages: Message[], featureInstruction = ''): number {
  const prompt = buildWebPrompt(messages, featureInstruction);
  return Math.ceil(prompt.length * CONTEXT_TOKEN_MULTIPLIER);
}

/** Remove common agent-framework wrappers from user messages. */
function stripClientMetadata(text: string): string {
  const timestampPattern = /\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\S+\]\s*/;
  const match = text.match(timestampPattern);
  if (match) {
    const afterTimestamp = text.slice(match.index! + match[0].length).trim();
    return afterTimestamp || text;
  }

  const boilerplatePatterns = [
    /^A new session was started via\b/m,
    /^Run your Session Startup sequence\b/m,
    /^Current time:/m,
    /^Sender \(untrusted metadata\):/m,
  ];
  const hasBoilerplate = boilerplatePatterns.some(p => p.test(text));
  if (hasBoilerplate) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.startsWith('{') || line.startsWith('}') || line.startsWith('"') || line.startsWith('```')) continue;
      if (boilerplatePatterns.some(p => p.test(line))) continue;
      if (/^Current time:/i.test(line)) continue;
      return line;
    }
  }

  return text;
}

export type { StreamEvent } from './stream.js';
