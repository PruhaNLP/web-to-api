import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DeepSeekPowChallenge {
  algorithm: string;
  challenge: string;
  difficulty: number;
  salt: string;
  signature: string;
  expire_at?: number;
}

interface DeepSeekWasmExports {
  memory: WebAssembly.Memory;
  __wbindgen_export_0: (a: number, b: number) => number;
  __wbindgen_add_to_stack_pointer: (a: number) => number;
  wasm_solve: (
    retptr: number,
    ptrC: number, lenC: number,
    ptrP: number, lenP: number,
    difficulty: number,
  ) => void;
}

// Lazy-loaded WASM module
let wasmInstance: WebAssembly.Instance | null = null;

async function getWasmInstance(): Promise<WebAssembly.Instance> {
  if (wasmInstance) return wasmInstance;

  // Load WASM from base64 file bundled alongside this module
  const wasmB64Path = join(dirname(fileURLToPath(import.meta.url)), 'deepseek-hash-v1.wasm.b64');
  const b64 = readFileSync(wasmB64Path, 'utf-8').trim();
  const wasmBuffer = Buffer.from(b64, 'base64');
  const { instance } = await WebAssembly.instantiate(wasmBuffer, { wbg: {} });
  wasmInstance = instance;
  return instance;
}

/**
 * Solve DeepSeek SHA256 Proof of Work challenge.
 */
export function solvePowSha256(challenge: DeepSeekPowChallenge): number {
  const { challenge: target, salt, difficulty } = challenge;
  const targetDifficulty = difficulty > 1000
    ? Math.floor(Math.log2(difficulty))
    : difficulty;

  let nonce = 0;
  while (nonce < 10_000_000) {
    const input = salt + target + nonce;
    const hash = createHash('sha256').update(input).digest('hex');

    let zeroBits = 0;
    for (const char of hash) {
      const val = parseInt(char, 16);
      if (val === 0) {
        zeroBits += 4;
      } else {
        zeroBits += Math.clz32(val) - 28;
        break;
      }
    }

    if (zeroBits >= targetDifficulty) {
      return nonce;
    }
    nonce++;
  }

  throw new Error(`SHA256 PoW timeout after ${nonce} iterations`);
}

/**
 * Solve DeepSeek HashV1 Proof of Work using WASM module.
 */
export async function solvePowDeepSeekHashV1(challenge: DeepSeekPowChallenge): Promise<number> {
  const instance = await getWasmInstance();
  const exports = instance.exports as unknown as DeepSeekWasmExports;
  const memory = exports.memory;
  const alloc = exports.__wbindgen_export_0;
  const addToStack = exports.__wbindgen_add_to_stack_pointer;
  const wasmSolve = exports.wasm_solve;

  const prefix = `${challenge.salt}_${challenge.expire_at}_`;
  const challengeStr = challenge.challenge;

  const encodeString = (str: string) => {
    const buf = Buffer.from(str, 'utf8');
    const ptr = alloc(buf.length, 1);
    new Uint8Array(memory.buffer).set(buf, ptr);
    return [ptr, buf.length] as const;
  };

  const [ptrC, lenC] = encodeString(challengeStr);
  const [ptrP, lenP] = encodeString(prefix);
  const retptr = addToStack(-16);

  wasmSolve(retptr, ptrC, lenC, ptrP, lenP, challenge.difficulty);

  const view = new DataView(memory.buffer);
  const status = view.getInt32(retptr, true);
  const answer = view.getFloat64(retptr + 8, true);
  addToStack(16);

  if (status === 0) {
    throw new Error('DeepSeekHashV1 failed to find solution');
  }

  return answer;
}

/**
 * Unified PoW solver — dispatches by algorithm.
 */
export async function solvePow(challenge: DeepSeekPowChallenge): Promise<number> {
  if (challenge.algorithm === 'sha256') {
    return solvePowSha256(challenge);
  }
  if (challenge.algorithm === 'DeepSeekHashV1') {
    return solvePowDeepSeekHashV1(challenge);
  }
  throw new Error(`Unsupported PoW algorithm: ${challenge.algorithm}`);
}

/**
 * Build the x-ds-pow-response header value.
 */
export function buildPowResponse(
  challenge: DeepSeekPowChallenge,
  answer: number,
  targetPath: string,
): string {
  const obj = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    difficulty: challenge.difficulty,
    salt: challenge.salt,
    signature: challenge.signature,
    ...(challenge.expire_at !== undefined && { expire_at: challenge.expire_at }),
    answer,
    target_path: targetPath,
  };
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}
