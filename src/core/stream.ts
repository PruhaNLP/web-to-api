export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'done'; reason: 'stop' | 'tool_use' | 'length' }
  | { type: 'error'; message: string; code?: string };
