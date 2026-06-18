import { describe, it, expect } from 'vitest';
import { solvePowSha256, solvePow, buildPowResponse, type DeepSeekPowChallenge } from '../../../src/providers/deepseek/pow.js';

describe('DeepSeek PoW Solver', () => {
  it('solves SHA256 challenge with low difficulty', () => {
    const challenge: DeepSeekPowChallenge = {
      algorithm: 'sha256',
      challenge: 'test-challenge',
      difficulty: 4,  // Very low — should solve instantly
      salt: 'test-salt',
      signature: 'test-sig',
    };
    const nonce = solvePowSha256(challenge);
    expect(typeof nonce).toBe('number');
    expect(nonce).toBeGreaterThanOrEqual(0);
  });

  it('produces valid hash with enough leading zeros', () => {
    const { createHash } = require('node:crypto');
    const challenge: DeepSeekPowChallenge = {
      algorithm: 'sha256',
      challenge: 'verify-test',
      difficulty: 8,
      salt: 'verify-salt',
      signature: 'sig',
    };
    const nonce = solvePowSha256(challenge);

    // Verify the hash manually
    const input = challenge.salt + challenge.challenge + nonce;
    const hash = createHash('sha256').update(input).digest('hex');

    // First 2 hex chars should be '00' for difficulty 8
    let zeroBits = 0;
    for (const char of hash) {
      const val = parseInt(char, 16);
      if (val === 0) { zeroBits += 4; } else { zeroBits += Math.clz32(val) - 28; break; }
    }
    expect(zeroBits).toBeGreaterThanOrEqual(8);
  });

  it('handles difficulty > 1000 (log2 conversion)', () => {
    const challenge: DeepSeekPowChallenge = {
      algorithm: 'sha256',
      challenge: 'high-diff',
      difficulty: 65536,  // log2(65536) = 16
      salt: 'high-salt',
      signature: 'sig',
    };
    const nonce = solvePowSha256(challenge);
    expect(typeof nonce).toBe('number');
  });

  it('throws on unsupported algorithm', async () => {
    const challenge: DeepSeekPowChallenge = {
      algorithm: 'DeepSeekHashV1',
      challenge: 'test',
      difficulty: 4,
      salt: 'salt',
      signature: 'sig',
    };
    await expect(solvePow(challenge)).rejects.toThrow('DeepSeekHashV1 failed');
  });

  it('buildPowResponse creates valid base64 JSON', () => {
    const challenge: DeepSeekPowChallenge = {
      algorithm: 'sha256',
      challenge: 'test',
      difficulty: 4,
      salt: 'salt',
      signature: 'sig',
    };
    const response = buildPowResponse(challenge, 42, '/api/v0/chat/completion');

    // Decode and verify
    const decoded = JSON.parse(Buffer.from(response, 'base64').toString());
    expect(decoded.algorithm).toBe('sha256');
    expect(decoded.answer).toBe(42);
    expect(decoded.target_path).toBe('/api/v0/chat/completion');
    expect(decoded.challenge).toBe('test');
  });

  it('buildPowResponse includes expire_at when present', () => {
    const challenge: DeepSeekPowChallenge = {
      algorithm: 'sha256',
      challenge: 'test',
      difficulty: 4,
      salt: 'salt',
      signature: 'sig',
      expire_at: 1234567890,
    };
    const response = buildPowResponse(challenge, 0, '/path');
    const decoded = JSON.parse(Buffer.from(response, 'base64').toString());
    expect(decoded.expire_at).toBe(1234567890);
  });
});
