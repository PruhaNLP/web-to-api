import { homedir } from 'node:os';
import { join } from 'node:path';
import { findChromePath } from '../doctor.js';

/** Chrome profile outside dot-directories — required for Snap Chromium on Linux. */
export function defaultChromeProfileDir(): string {
  return join(homedir(), 'web-to-api', 'chrome-profile');
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
