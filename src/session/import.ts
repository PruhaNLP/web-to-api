import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserStateImportPayload, BrowserStateImportResult } from '../browser/manager.js';
import { importsDir } from '../config/paths.js';
import { getProviderSessionSpec, PROVIDER_SESSION_SPECS, describeExpectedImportFiles, type ProviderSessionSpec } from './import-config.js';

export type ImportPersistKind = 'cookies' | 'state' | 'single';

export interface ImportCandidate {
  providerId: string;
  filePath: string;
  fileName: string;
  state: BrowserStateImportPayload;
  spec: ProviderSessionSpec;
}

export interface ImportRunResult {
  providerId: string;
  file?: string;
  status: 'imported' | 'skipped' | 'error';
  message?: string;
  detail?: BrowserStateImportResult;
  error?: string;
}

export function parseStateFile(parsed: unknown, fallbackOrigin: string): BrowserStateImportPayload {
  if (Array.isArray(parsed)) {
    return { origin: fallbackOrigin, cookies: parsed };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Unsupported session JSON format');
  }

  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.cookies) && Array.isArray(obj.origins)) {
    return normalizePlaywrightStorageState(obj, fallbackOrigin);
  }

  return {
    url: typeof obj.url === 'string' ? obj.url : undefined,
    origin: typeof obj.origin === 'string' ? obj.origin : fallbackOrigin,
    localStorage: normalizeRecord(obj.localStorage),
    sessionStorage: normalizeRecord(obj.sessionStorage),
    cookies: typeof obj.cookies === 'string' || Array.isArray(obj.cookies)
      ? obj.cookies as BrowserStateImportPayload['cookies']
      : undefined,
  };
}

export function parseStateFileFromPath(filePath: string, fallbackOrigin: string): BrowserStateImportPayload {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  return parseStateFile(parsed, fallbackOrigin);
}

function firstExistingFile(sourceDir: string, fileNames: string[]): string | null {
  for (const fileName of fileNames) {
    const filePath = join(sourceDir, fileName);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

export function findImportCandidates(sourceDir: string): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  const seenProviders = new Set<string>();

  for (const spec of PROVIDER_SESSION_SPECS) {
    if (seenProviders.has(spec.providerId)) continue;

    if (spec.dualImport) {
      const cookiesPath = firstExistingFile(sourceDir, spec.dualImport.cookiesFiles);
      const statePath = firstExistingFile(sourceDir, spec.dualImport.stateFiles);
      if (cookiesPath && statePath) {
        seenProviders.add(spec.providerId);
        candidates.push({
          providerId: spec.providerId,
          filePath: statePath,
          fileName: `${spec.dualImport.cookiesFiles[0]} + ${spec.dualImport.stateFiles[0]}`,
          spec,
          state: mergeImportPayloads(
            parseStateFileFromPath(cookiesPath, spec.origin),
            parseStateFileFromPath(statePath, spec.origin),
            spec.origin,
          ),
        });
        continue;
      }
    }

    for (const fileName of spec.importFiles) {
      const filePath = join(sourceDir, fileName);
      if (!existsSync(filePath)) continue;
      seenProviders.add(spec.providerId);
      candidates.push({
        providerId: spec.providerId,
        filePath,
        fileName,
        spec,
        state: parseStateFileFromPath(filePath, spec.origin),
      });
      break;
    }

    if (spec.dualImport && !seenProviders.has(spec.providerId)) {
      const partialPath = firstExistingFile(sourceDir, [
        ...spec.dualImport.stateFiles,
        ...spec.dualImport.cookiesFiles,
      ]);
      if (partialPath) {
        seenProviders.add(spec.providerId);
        candidates.push({
          providerId: spec.providerId,
          filePath: partialPath,
          fileName: partialPath.split('/').pop() || partialPath,
          spec,
          state: parseStateFileFromPath(partialPath, spec.origin),
        });
      }
    }
  }

  return candidates;
}

export function mergeImportPayloads(
  cookiesPart: BrowserStateImportPayload,
  statePart: BrowserStateImportPayload,
  origin: string,
): BrowserStateImportPayload {
  const cookiesFromCookies = Array.isArray(cookiesPart.cookies) ? cookiesPart.cookies : [];
  const cookiesFromState = Array.isArray(statePart.cookies) ? statePart.cookies : [];
  return {
    url: statePart.url || cookiesPart.url,
    origin: statePart.origin || cookiesPart.origin || origin,
    localStorage: { ...cookiesPart.localStorage, ...statePart.localStorage },
    sessionStorage: { ...cookiesPart.sessionStorage, ...statePart.sessionStorage },
    cookies: cookiesFromCookies.length > 0 ? cookiesFromCookies : cookiesFromState.length > 0
      ? cookiesFromState
      : statePart.cookies ?? cookiesPart.cookies,
  };
}

export async function importSessionsFromDir(
  sourceDir: string,
  importFn: (state: BrowserStateImportPayload) => Promise<BrowserStateImportResult>,
  onImported?: (providerId: string) => void,
): Promise<ImportRunResult[]> {
  const results: ImportRunResult[] = [];

  for (const spec of PROVIDER_SESSION_SPECS) {
    let imported = false;

    if (spec.dualImport) {
      const cookiesPath = firstExistingFile(sourceDir, spec.dualImport.cookiesFiles);
      const statePath = firstExistingFile(sourceDir, spec.dualImport.stateFiles);
      if (cookiesPath && statePath) {
        try {
          const cookiesState = parseStateFileFromPath(cookiesPath, spec.origin);
          const localState = parseStateFileFromPath(statePath, spec.origin);
          await importFn(cookiesState);
          const detail = await importFn(localState);
          onImported?.(spec.providerId);
          results.push({
            providerId: spec.providerId,
            file: `${spec.dualImport.cookiesFiles[0]} + ${spec.dualImport.stateFiles[0]}`,
            status: 'imported',
            detail,
          });
          imported = true;
        } catch (err) {
          results.push({
            providerId: spec.providerId,
            file: `${spec.dualImport.cookiesFiles[0]} + ${spec.dualImport.stateFiles[0]}`,
            status: 'error',
            error: (err as Error).message,
          });
          imported = true;
        }
      }
    }

    if (!imported) {
    for (const fileName of spec.importFiles) {
      const filePath = join(sourceDir, fileName);
      if (!existsSync(filePath)) continue;

      try {
        const state = parseStateFileFromPath(filePath, spec.origin);
        const detail = await importFn(state);
        onImported?.(spec.providerId);
        results.push({
          providerId: spec.providerId,
          file: fileName,
          status: 'imported',
          detail,
        });
        imported = true;
        break;
      } catch (err) {
        results.push({
          providerId: spec.providerId,
          file: fileName,
          status: 'error',
          error: (err as Error).message,
        });
        imported = true;
        break;
      }
    }
    }

    if (!imported) {
      results.push({
        providerId: spec.providerId,
        status: 'skipped',
        message: `No import files (${describeExpectedImportFiles(spec)})`,
      });
    }
  }

  return results;
}

export function defaultImportsSourceDir(stateDir: string): string {
  return process.env.WTA_IMPORTS_DIR || importsDir(stateDir);
}

export function resolveImportPersistFilename(
  providerId: string,
  kind: ImportPersistKind,
): string | null {
  const spec = getProviderSessionSpec(providerId);
  if (!spec) return null;
  if (kind === 'cookies' && spec.dualImport) return spec.dualImport.cookiesFiles[0] ?? null;
  if (kind === 'state' && spec.dualImport) return spec.dualImport.stateFiles[0] ?? null;
  if (kind === 'single') {
    return spec.dualImport?.cookiesFiles[0] ?? spec.importFiles[0] ?? null;
  }
  return spec.importFiles[0] ?? null;
}

/** Save uploaded session JSON to ~/.web-to-api/imports for restart auto-import. */
export function persistImportRawFile(stateDir: string, fileName: string, raw: unknown): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(base)) {
    throw new Error(`Invalid import filename: ${fileName}`);
  }
  const dir = defaultImportsSourceDir(stateDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, base);
  writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

function normalizePlaywrightStorageState(state: Record<string, unknown>, fallbackOrigin: string): BrowserStateImportPayload {
  const origins = Array.isArray(state.origins) ? state.origins as Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: unknown }> }> : [];
  const matched = origins.find(entry => entry.origin === fallbackOrigin) || origins[0];
  const localStorage = Object.fromEntries(
    (matched?.localStorage || [])
      .filter(entry => typeof entry?.name === 'string')
      .map(entry => [entry.name!, String(entry.value ?? '')]),
  );

  return {
    origin: matched?.origin || fallbackOrigin,
    localStorage,
    cookies: state.cookies as BrowserStateImportPayload['cookies'],
  };
}

function normalizeRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, String(val ?? '')]),
  );
}
