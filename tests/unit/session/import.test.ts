import { describe, it, expect } from 'vitest';
import { parseStateFile } from '../../../src/session/import.js';

describe('session import', () => {
  it('parses cookie array export', () => {
    const state = parseStateFile([
      { name: 'kimi-auth', value: 'token123', domain: '.kimi.com', path: '/' },
    ], 'https://www.kimi.ai');
    expect(state.origin).toBe('https://www.kimi.ai');
    expect(Array.isArray(state.cookies)).toBe(true);
  });

  it('parses custom object with localStorage', () => {
    const state = parseStateFile({
      origin: 'https://chat.deepseek.com',
      localStorage: { userToken: '{"value":{"jwt":"abc"}}' },
      cookies: 'ds_session_id=1',
    }, 'https://chat.deepseek.com');
    expect(state.localStorage?.userToken).toContain('jwt');
    expect(state.cookies).toBe('ds_session_id=1');
  });

  it('parses Playwright storageState', () => {
    const state = parseStateFile({
      cookies: [{ name: 'cna', value: 'x', domain: '.qwen.ai', path: '/' }],
      origins: [{
        origin: 'https://chat.qwen.ai',
        localStorage: [{ name: 'token', value: 't1' }],
      }],
    }, 'https://chat.qwen.ai');
    expect(state.localStorage?.token).toBe('t1');
  });
});
