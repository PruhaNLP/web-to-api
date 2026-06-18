import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthStore } from '../../../src/auth/store.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AuthStore', () => {
  let testDir: string;
  let store: AuthStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `wmb-auth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    store = new AuthStore(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns "none" for unknown provider', () => {
    expect(store.getStatus('claude-web')).toEqual({
      providerId: 'claude-web',
      status: 'none',
      lastCheck: null,
    });
  });

  it('sets and gets status', () => {
    store.setStatus('claude-web', 'active');
    const s = store.getStatus('claude-web');
    expect(s.status).toBe('active');
    expect(s.lastCheck).toBeTypeOf('string');
  });

  it('persists to disk and reloads', () => {
    store.setStatus('claude-web', 'active');
    store.setStatus('deepseek-web', 'expired');

    const store2 = new AuthStore(testDir);
    expect(store2.getStatus('claude-web').status).toBe('active');
    expect(store2.getStatus('deepseek-web').status).toBe('expired');
  });

  it('getAllStatuses returns all known providers', () => {
    store.setStatus('claude-web', 'active');
    store.setStatus('chatgpt-web', 'none');
    const all = store.getAllStatuses();
    expect(all).toHaveLength(2);
    expect(all.map(s => s.providerId)).toContain('claude-web');
    expect(all.map(s => s.providerId)).toContain('chatgpt-web');
  });

  it('clearStatus removes a provider', () => {
    store.setStatus('claude-web', 'active');
    store.clearStatus('claude-web');
    expect(store.getStatus('claude-web').status).toBe('none');
  });

  it('setStatus overwrites previous status', () => {
    store.setStatus('claude-web', 'active');
    store.setStatus('claude-web', 'expired');
    expect(store.getStatus('claude-web').status).toBe('expired');
  });
});
