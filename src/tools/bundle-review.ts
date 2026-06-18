import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ======Settings=========
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const OUTPUT_FILE = join(ROOT, 'review-bundle.txt');
const MAX_TOTAL_LINES = 3000;
const SEP = '='.repeat(72);

/** path → бюджет строк (head + tail, если не влезает). */
const FILE_BUDGET: Array<{ path: string; lines: number }> = [
  { path: 'README.md', lines: 100 },
  { path: 'package.json', lines: 45 },
  { path: 'src/cli.ts', lines: 220 },
  { path: 'src/server.ts', lines: 90 },
  { path: 'src/routes/openai-compat.ts', lines: 280 },
  { path: 'src/routes/management.ts', lines: 220 },
  { path: 'src/browser/manager.ts', lines: 200 },
  { path: 'src/session/import-config.ts', lines: 90 },
  { path: 'src/session/import.ts', lines: 180 },
  { path: 'src/auth/store.ts', lines: 60 },
  { path: 'src/config/paths.ts', lines: 50 },
  { path: 'src/config/loader.ts', lines: 100 },
  { path: 'src/config/proxy.ts', lines: 70 },
  { path: 'src/core/logger.ts', lines: 95 },
  { path: 'src/core/registry.ts', lines: 80 },
  { path: 'src/core/router.ts', lines: 80 },
  { path: 'src/core/provider.ts', lines: 70 },
  { path: 'src/core/openai-features.ts', lines: 120 },
  { path: 'src/core/errors.ts', lines: 80 },
  { path: 'src/providers/deepseek/index.ts', lines: 150 },
  { path: 'src/providers/qwen-web/index.ts', lines: 180 },
  { path: 'src/providers/kimi-web/index.ts', lines: 100 },
  { path: 'src/dashboard/index.html', lines: 120 },
];
// ======Settings=========

function extractLines(allLines: string[], budget: number): string[] {
  if (allLines.length <= budget) return allLines;

  const head = Math.max(1, Math.floor(budget * 0.75));
  const tail = Math.max(0, budget - head - 1);
  const omitted = allLines.length - head - tail;

  const out = allLines.slice(0, head);
  if (omitted > 0) {
    out.push(`... [${omitted} lines omitted] ...`);
  }
  if (tail > 0) {
    out.push(...allLines.slice(-tail));
  }
  return out;
}

function readFileLines(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [`[missing: ${rel}]`];
  return readFileSync(abs, 'utf-8').split(/\r?\n/);
}

function buildBundle(): { text: string; fileCount: number; totalLines: number } {
  const parts: string[] = [
    'web-to-api — compact review bundle',
    `Generated: ${new Date().toISOString()}`,
    `Budget: ${MAX_TOTAL_LINES} lines max, excerpts only`,
    '',
  ];

  let used = parts.length;
  let included = 0;
  const skipped: string[] = [];

  for (const { path, lines: budget } of FILE_BUDGET) {
    const overhead = 4;
    const remaining = MAX_TOTAL_LINES - used - overhead;
    if (remaining < 20) {
      skipped.push(path);
      continue;
    }

    const sliceBudget = Math.min(budget, remaining);
    const raw = readFileLines(path);
    const excerpt = extractLines(raw, sliceBudget);

    parts.push(SEP);
    parts.push(`FILE: ${path}  (${excerpt.length}/${raw.length} lines)`);
    parts.push(SEP);
    parts.push(...excerpt);
    parts.push('');

    used += overhead + excerpt.length + 1;
    included += 1;
  }

  if (skipped.length > 0) {
    parts.push(SEP);
    parts.push('OMITTED (budget exhausted):');
    parts.push(skipped.join(', '));
  }

  const text = parts.join('\n');
  return { text, fileCount: included, totalLines: text.split('\n').length };
}

const { text, fileCount, totalLines } = buildBundle();
writeFileSync(OUTPUT_FILE, text, 'utf-8');
console.log(`Written: ${OUTPUT_FILE}`);
console.log(`Files: ${fileCount}`);
console.log(`Lines: ${totalLines} / ${MAX_TOTAL_LINES}`);
console.log(`Size: ${(Buffer.byteLength(text, 'utf-8') / 1024).toFixed(1)} KB`);
