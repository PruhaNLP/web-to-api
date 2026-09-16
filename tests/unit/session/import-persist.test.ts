import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  persistImportRawFile,
  resolveImportPersistFilename,
  findImportCandidates,
} from '../../../src/session/import.js';

describe('import persistence', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('resolves dual-import filenames', () => {
    expect(resolveImportPersistFilename('deepseek-web', 'single')).toBe('deepseek-state.json');
    expect(resolveImportPersistFilename('kimi-web', 'single')).toBe('kimi.json');
  });

  it('writes raw JSON into imports dir', () => {
    dir = mkdtempSync(join(tmpdir(), 'wta-import-'));
    const imports = join(dir, 'imports');
    const saved = persistImportRawFile(dir, 'kimi.json', [{ name: 'kimi-auth', value: 'x' }]);
    expect(saved).toBe(join(imports, 'kimi.json'));
    expect(JSON.parse(readFileSync(saved, 'utf-8'))).toEqual([{ name: 'kimi-auth', value: 'x' }]);
  });

  it('finds deepseek state import candidates', () => {
    dir = mkdtempSync(join(tmpdir(), 'wta-import-'));
    persistImportRawFile(dir, 'deepseek-state.json', {
      origin: 'https://chat.deepseek.com',
      localStorage: { userToken: 'jwt' },
    });
    const candidates = findImportCandidates(join(dir, 'imports'));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].providerId).toBe('deepseek-web');
    expect(candidates[0].fileName).toBe('deepseek-state.json');
    expect(candidates[0].state.localStorage?.userToken).toBe('jwt');
  });
});
