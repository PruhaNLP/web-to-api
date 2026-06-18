import type { Message, ToolDef } from './provider.js';

// ======Settings=========
const TOOL_OUTPUT_INSTRUCTION = `CRITICAL OUTPUT RULES — ANY VIOLATION CAUSES IMMEDIATE PARSE FAILURE:
1. Your ENTIRE response MUST be a single raw JSON object. Nothing else.
2. FORBIDDEN: markdown, code fences (\`\`\`), comments, explanations, preamble, postscript, plain text.
3. FORBIDDEN: any text before "{" or after "}".
4. Use EXACTLY one of these two formats — no other top-level keys, no variants:

Tool call (you can call multiple tools in one turn if needed):
{"tool_calls":[{"name":"<exact_tool_name>","arguments":{...}}, {"name":"<another_tool>","arguments":{...}}]}

No tool call:
{"content":"<your answer>"}

5. "arguments" MUST be a JSON object (never a string).
6. "name" MUST match one of the available tools exactly (case-sensitive).
7. FORBIDDEN top-level keys: "message", "response", "result", "answer", "output", "text", "data".`;

const JSON_OUTPUT_INSTRUCTION = `CRITICAL OUTPUT RULES — ANY VIOLATION CAUSES IMMEDIATE PARSE FAILURE:
1. Your ENTIRE response MUST be a single raw JSON object. Nothing else.
2. FORBIDDEN: markdown, code fences (\`\`\`), comments, explanations, preamble, postscript, plain text.
3. FORBIDDEN: any text before "{" or after "}".
4. Output MUST start with "{" and end with "}".
5. Follow the schema EXACTLY: all required fields present, correct types, correct enum values.
6. FORBIDDEN: wrapping JSON in quotes, escaping JSON as a string, or nesting JSON inside another object.`;

const MAX_SCHEMA_CHARS = 6000;
// ======Settings=========

export interface OpenAIResponseFormat {
  type?: string;
  json_schema?: {
    name?: string;
    strict?: boolean;
    schema?: unknown;
  };
}

export interface OpenAIToolChoiceFunction {
  type: 'function';
  function: { name: string };
}

export type OpenAIToolChoice = 'auto' | 'none' | 'required' | OpenAIToolChoiceFunction;

export interface OpenAIFeatureOptions {
  tools?: ToolDef[];
  toolChoice?: OpenAIToolChoice;
  responseFormat?: OpenAIResponseFormat;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ParsedAssistantOutput =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; toolCalls: OpenAIToolCall[] }
  | { type: 'error'; message: string; raw: string };

export function hasPseudoFeatures(opts: OpenAIFeatureOptions): boolean {
  return hasTools(opts) || hasStructuredOutput(opts);
}

export function buildOpenAIFeatureInstruction(opts: OpenAIFeatureOptions): string {
  return buildInstruction(opts);
}

export function prepareMessagesForOpenAIFeatures(
  messages: Message[],
  opts: OpenAIFeatureOptions,
): Message[] {
  const instruction = buildInstruction(opts);
  if (!instruction) return messages;

  const next = messages.map((m) => ({ ...m }));
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'user') {
      next[i].content = `${next[i].content}\n\n${instruction}`;
      return next;
    }
  }
  return [...next, { role: 'user', content: instruction }];
}

export function parseAssistantOutput(
  rawContent: string,
  opts: OpenAIFeatureOptions,
): ParsedAssistantOutput {
  if (!hasPseudoFeatures(opts)) {
    return { type: 'text', content: rawContent };
  }

  const extracted = extractJsonCandidate(rawContent);
  if (!extracted) {
    if (hasStructuredOutput(opts) || hasTools(opts)) {
      return { type: 'error', message: 'Model did not return valid JSON for pseudo OpenAI features', raw: rawContent };
    }
    return { type: 'text', content: rawContent };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    return { type: 'error', message: 'Model returned malformed JSON for pseudo OpenAI features', raw: rawContent };
  }

  if (hasTools(opts)) {
    const toolCalls = parseToolCalls(parsed, opts.tools ?? []);
    if (toolCalls.length > 0) {
      return { type: 'tool_calls', toolCalls };
    }
    const content = typeof (parsed as any)?.content === 'string'
      ? (parsed as any).content
      : JSON.stringify(parsed);
    return { type: 'text', content };
  }

  const validationError = validateResponseFormat(parsed, opts.responseFormat);
  if (validationError) {
    return { type: 'error', message: validationError, raw: rawContent };
  }

  return { type: 'text', content: JSON.stringify(parsed) };
}

function buildInstruction(opts: OpenAIFeatureOptions): string {
  const parts: string[] = [];
  if (hasTools(opts)) {
    parts.push(buildToolInstruction(opts.tools ?? [], opts.toolChoice));
  }
  if (hasStructuredOutput(opts)) {
    parts.push(buildStructuredOutputInstruction(opts.responseFormat));
  }
  return parts.join('\n\n');
}

function hasTools(opts: OpenAIFeatureOptions): boolean {
  return Array.isArray(opts.tools) && opts.tools.length > 0 && opts.toolChoice !== 'none';
}

function hasStructuredOutput(opts: OpenAIFeatureOptions): boolean {
  const type = opts.responseFormat?.type;
  return type === 'json_object' || type === 'json_schema';
}

function buildToolInstruction(tools: ToolDef[], toolChoice: OpenAIToolChoice | undefined): string {
  const toolList = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
  const requiredName = typeof toolChoice === 'object' && toolChoice?.type === 'function'
    ? toolChoice.function.name
    : null;
  const requiredText = toolChoice === 'required'
    ? 'You MUST call one of the available tools. A text-only {"content":...} response is NOT allowed.'
    : requiredName
      ? `You MUST call the tool named "${requiredName}". No other tool and no {"content":...} response.`
      : 'Call a tool only when necessary; otherwise respond with {"content":"..."}.';
  return [
    '=== MANDATORY TOOL-CALLING MODE (HIGHEST PRIORITY — OVERRIDES ALL OTHER INSTRUCTIONS) ===',
    'You are NOT in a chat. You are a JSON-only output machine. Any non-JSON output is rejected.',
    requiredText,
    `Available tools (use EXACT names): ${JSON.stringify(toolList)}`,
    TOOL_OUTPUT_INSTRUCTION,
    'FINAL REMINDER: Output ONLY raw JSON. No prose, no markdown, no code blocks.',
  ].join('\n');
}

function buildStructuredOutputInstruction(responseFormat: OpenAIResponseFormat | undefined): string {
  if (responseFormat?.type === 'json_schema') {
    const schema = responseFormat.json_schema?.schema;
    const schemaText = schema ? JSON.stringify(schema).slice(0, MAX_SCHEMA_CHARS) : '{}';
    const strict = responseFormat.json_schema?.strict !== false;
    const strictText = strict
      ? 'STRICT MODE: output must match the schema EXACTLY. No additional properties. Missing, extra, or mistyped fields cause rejection.'
      : 'Output must conform to the schema below.';
    return [
      '=== MANDATORY STRUCTURED OUTPUT MODE (HIGHEST PRIORITY — OVERRIDES ALL OTHER INSTRUCTIONS) ===',
      'You are NOT in a chat. You are a JSON-only output machine. Any non-JSON output is rejected.',
      strictText,
      JSON_OUTPUT_INSTRUCTION,
      `JSON schema (follow EXACTLY): ${schemaText}`,
      'FINAL REMINDER: Output ONLY raw JSON matching the schema. No prose, no markdown, no code blocks.',
    ].join('\n');
  }
  return [
    '=== MANDATORY JSON OUTPUT MODE (HIGHEST PRIORITY — OVERRIDES ALL OTHER INSTRUCTIONS) ===',
    'You are NOT in a chat. You are a JSON-only output machine. Any non-JSON output is rejected.',
    'Return a single JSON object — not an array, not a string, not wrapped in any container.',
    JSON_OUTPUT_INSTRUCTION,
    'FINAL REMINDER: Output ONLY raw JSON. No prose, no markdown, no code blocks.',
  ].join('\n');
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced ? fenced[1].trim() : trimmed;
  if (source.startsWith('{') || source.startsWith('[')) return source;

  const objectStart = source.indexOf('{');
  const objectEnd = source.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return source.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = source.indexOf('[');
  const arrayEnd = source.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return source.slice(arrayStart, arrayEnd + 1);
  }

  return null;
}

function parseToolCalls(parsed: unknown, tools: ToolDef[]): OpenAIToolCall[] {
  const allowed = new Set(tools.map((t) => t.function.name));
  const rawCalls: unknown[] = Array.isArray((parsed as any)?.tool_calls)
    ? (parsed as any).tool_calls
    : (parsed as any)?.tool_call
      ? [(parsed as any).tool_call]
      : [];

  return rawCalls
    .map((call: any, index: number): OpenAIToolCall | null => {
      const name = call?.name ?? call?.function?.name;
      if (typeof name !== 'string' || !allowed.has(name)) return null;
      const args = call?.arguments ?? call?.function?.arguments ?? {};
      const argString = typeof args === 'string' ? args : JSON.stringify(args);
      return {
        id: typeof call?.id === 'string' ? call.id : `call_${Date.now().toString(36)}_${index}`,
        type: 'function',
        function: { name, arguments: argString },
      };
    })
    .filter((call: OpenAIToolCall | null): call is OpenAIToolCall => call !== null);
}

function validateResponseFormat(parsed: unknown, responseFormat: OpenAIResponseFormat | undefined): string | null {
  if (responseFormat?.type === 'json_object' && !isPlainObject(parsed)) {
    return 'response_format=json_object requires a JSON object';
  }
  const schema = responseFormat?.type === 'json_schema'
    ? responseFormat.json_schema?.schema
    : null;
  if (!schema) return null;
  return validateJsonSchemaSubset(parsed, schema);
}

function validateJsonSchemaSubset(value: unknown, schema: any, path = '$'): string | null {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type && !matchesType(value, schema.type)) {
    return `${path} does not match schema type ${schema.type}`;
  }
  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} is not one of the allowed enum values`;
  }
  if (schema.type === 'object' && isPlainObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) return `${path}.${key} is required`;
    }
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) {
        const err = validateJsonSchemaSubset((value as Record<string, unknown>)[key], childSchema, `${path}.${key}`);
        if (err) return err;
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validateJsonSchemaSubset(value[i], schema.items, `${path}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

function matchesType(value: unknown, type: string | string[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    if (t === 'null') return value === null;
    if (t === 'array') return Array.isArray(value);
    if (t === 'object') return isPlainObject(value);
    if (t === 'integer') return Number.isInteger(value);
    return typeof value === t;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
