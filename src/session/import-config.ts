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
    importFiles: ['deepseek-state.json', 'deepseek-storage.json'],
    authKind: 'cookies+localStorage',
    keyCookies: ['ds_session_id'],
    keyLocalStorage: ['userToken', 'settingsJwt'],
    hint: 'Upload Console state JSON. Auth is in localStorage (userToken / settingsJwt). Cookie-Editor no longer has the JWT.',
  },
  {
    providerId: 'kimi-web',
    name: 'Kimi',
    origin: 'https://www.kimi.ai',
    loginUrl: 'https://www.kimi.ai',
    importFiles: ['kimi.json', 'kimi-state.json', 'kimi-storage.json'],
    authKind: 'cookies',
    keyCookies: [],
    keyLocalStorage: ['refresh_token'],
    hint: 'Paste localStorage.refresh_token from kimi.ai. Access tokens are not used.',
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
