// ======Settings=========
/** What each provider needs to authenticate and chat. */
export type SessionAuthKind = 'profile-login' | 'cookies' | 'cookies+localStorage';

export interface ProviderDualImportSpec {
  /** Cookie-Editor JSON array (HttpOnly cookies). */
  cookiesFiles: string[];
  /** DevTools console export with localStorage. */
  stateFiles: string[];
}

export interface ProviderSessionSpec {
  providerId: string;
  name: string;
  origin: string;
  loginUrl: string;
  /** Single-file fallbacks (Playwright storageState, etc.). */
  importFiles: string[];
  /** When set, folder import merges cookies file + state file. */
  dualImport?: ProviderDualImportSpec;
  authKind: SessionAuthKind;
  /** Critical cookie names when importing cookie-only JSON. */
  keyCookies: string[];
  /** localStorage keys used at runtime (informational + validation hints). */
  keyLocalStorage: string[];
  hint: string;
}

export const PROVIDER_SESSION_SPECS: ProviderSessionSpec[] = [
  {
    providerId: 'deepseek-web',
    name: 'DeepSeek',
    origin: 'https://chat.deepseek.com',
    loginUrl: 'https://chat.deepseek.com/sign_in',
    importFiles: ['deepseek-storage.json'],
    dualImport: {
      cookiesFiles: ['deepseek.json'],
      stateFiles: ['deepseek-state.json'],
    },
    authKind: 'cookies+localStorage',
    keyCookies: ['ds_session_id', 'ds_chat_token'],
    keyLocalStorage: ['userToken', 'settingsJwt'],
    hint: 'Requires TWO files: Cookie-Editor cookies JSON + Console state JSON (localStorage).',
  },
  {
    providerId: 'kimi-web',
    name: 'Kimi',
    origin: 'https://www.kimi.com',
    loginUrl: 'https://www.kimi.com',
    importFiles: ['kimi.json', 'kimi-state.json', 'kimi-storage.json'],
    authKind: 'cookies',
    keyCookies: ['kimi-auth'],
    keyLocalStorage: [],
    hint: 'Usually enough: cookie `kimi-auth` (used as Bearer token). Cookie array export is OK.',
  },
  {
    providerId: 'qwen-web',
    name: 'Qwen',
    origin: 'https://chat.qwen.ai',
    loginUrl: 'https://chat.qwen.ai',
    importFiles: ['qwen-storage.json'],
    dualImport: {
      cookiesFiles: ['qwen.json'],
      stateFiles: ['qwen-state.json'],
    },
    authKind: 'cookies+localStorage',
    keyCookies: ['cna', 'token', 'isg'],
    keyLocalStorage: ['token', 'user_info'],
    hint: 'Requires TWO files: Cookie-Editor cookies JSON + Console state JSON (localStorage.token).',
  },
];

export function getProviderSessionSpec(providerId: string): ProviderSessionSpec | undefined {
  return PROVIDER_SESSION_SPECS.find(spec => spec.providerId === providerId);
}

export function describeExpectedImportFiles(spec: ProviderSessionSpec): string {
  if (spec.dualImport) {
    return `${spec.dualImport.cookiesFiles[0]} + ${spec.dualImport.stateFiles[0]}`;
  }
  return spec.importFiles.join(' | ');
}

// ======Settings=========
