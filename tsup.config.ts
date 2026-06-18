import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ======Settings=========
const DASHBOARD_FILES = ['index.html', 'app.js', 'style.css'];
const DEEPSEEK_POW_ASSET = 'deepseek-hash-v1.wasm.b64';
// ======Settings=========

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
  external: ['playwright-core'],
  onSuccess: async () => {
    const dashDir = join('dist', 'dashboard');
    mkdirSync(dashDir, { recursive: true });
    for (const file of DASHBOARD_FILES) {
      try {
        copyFileSync(join('src', 'dashboard', file), join(dashDir, file));
      } catch {
        // Dashboard files may not exist yet
      }
    }
    copyFileSync(join('src', 'providers', 'deepseek', DEEPSEEK_POW_ASSET), join('dist', DEEPSEEK_POW_ASSET));
  },
});
