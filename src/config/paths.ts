import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { findChromePath } from '../doctor.js';

// ======Settings=========
export const STATE_DIR_NAME = '.web-to-api';
export const IMPORTS_DIR_NAME = 'imports';
export const LOGS_DIR_NAME = 'logs';
// ======Settings=========

/** Runtime data: auth flags, settings, import drop zone. */
export function defaultStateDir(): string {
  return join(homedir(), STATE_DIR_NAME);
}

/** Chrome profile outside dot-directories — required for Snap Chromium on Linux. */
export function defaultChromeProfileDir(): string {
  return join(homedir(), 'web-to-api', 'chrome-profile');
}

/** Drop exported session JSON here — never the project root. */
export function importsDir(stateDir: string): string {
  return join(stateDir, IMPORTS_DIR_NAME);
}

export function logsDir(stateDir: string): string {
  return join(stateDir, LOGS_DIR_NAME);
}

export function ensureStateLayout(stateDir: string): { stateDir: string; importsDir: string; logsDir: string } {
  const imports = importsDir(stateDir);
  const logs = logsDir(stateDir);
  mkdirSync(imports, { recursive: true });
  mkdirSync(logs, { recursive: true });
  return { stateDir, importsDir: imports, logsDir: logs };
}

/** Snap Chromium cannot create SingletonLock inside $HOME dot-folders (e.g. ~/.web-to-api). */
export function isSnapChromiumProfileBlocked(profileDir: string): boolean {
  if (process.platform !== 'linux') return false;
  const chromePath = findChromePath();
  if (!chromePath?.includes('/snap/')) return false;
  const home = homedir();
  if (!profileDir.startsWith(home + '/') && profileDir !== home) return false;
  const rel = profileDir.slice(home.length).replace(/^\//, '');
  return rel.split('/').some((seg) => seg.startsWith('.'));
}
