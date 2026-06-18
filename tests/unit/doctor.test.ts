import { describe, it, expect } from 'vitest';
import { runDoctor, findChromePath } from '../../src/doctor.js';

describe('Doctor', () => {
  it('returns array of check results', async () => {
    const results = await runDoctor();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(5);
  });

  it('each result has required fields', async () => {
    const results = await runDoctor();
    for (const r of results) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('message');
      expect(['ok', 'warn', 'fail']).toContain(r.status);
    }
  });

  it('Node.js check passes (we are running on Node)', async () => {
    const results = await runDoctor();
    const nodeCheck = results.find(r => r.name === 'Node.js');
    expect(nodeCheck?.status).toBe('ok');
  });

  it('Platform check passes', async () => {
    const results = await runDoctor();
    const platformCheck = results.find(r => r.name === 'Platform');
    expect(platformCheck?.status).toBe('ok');
  });

  it('playwright-core check passes (installed in this project)', async () => {
    const results = await runDoctor();
    const pwCheck = results.find(r => r.name === 'playwright-core');
    expect(pwCheck?.status).toBe('ok');
  });

  it('findChromePath returns string or undefined', () => {
    const path = findChromePath();
    expect(path === undefined || typeof path === 'string').toBe(true);
  });
});
