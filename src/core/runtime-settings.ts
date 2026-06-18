import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ======Settings=========
const RUNTIME_SETTINGS_FILE = 'settings.json';
// ======Settings=========

export interface RuntimeSettings {
  autoModelOrder?: string[];
}

export function runtimeSettingsPath(stateDir: string): string {
  return join(stateDir, RUNTIME_SETTINGS_FILE);
}

export function loadRuntimeSettings(stateDir: string): RuntimeSettings {
  const filePath = runtimeSettingsPath(stateDir);
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      autoModelOrder: Array.isArray(parsed.autoModelOrder)
        ? parsed.autoModelOrder.filter((item: unknown) => typeof item === 'string')
        : undefined,
    };
  } catch {
    return {};
  }
}

export function saveRuntimeSettings(stateDir: string, settings: RuntimeSettings): void {
  const filePath = runtimeSettingsPath(stateDir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}
