import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export type AuthStatus = 'active' | 'expired' | 'none';

export interface ProviderAuthStatus {
  providerId: string;
  status: AuthStatus;
  lastCheck: string | null;
}

interface AuthData {
  [providerId: string]: {
    status: AuthStatus;
    lastCheck: string;
  };
}

export class AuthStore {
  private data: AuthData;
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'auth.json');
    this.data = this.load();
  }

  getStatus(providerId: string): ProviderAuthStatus {
    const entry = this.data[providerId];
    if (!entry) {
      return { providerId, status: 'none', lastCheck: null };
    }
    return { providerId, status: entry.status, lastCheck: entry.lastCheck };
  }

  getAllStatuses(): ProviderAuthStatus[] {
    return Object.keys(this.data).map(id => this.getStatus(id));
  }

  setStatus(providerId: string, status: AuthStatus): void {
    this.data[providerId] = {
      status,
      lastCheck: new Date().toISOString(),
    };
    this.save();
  }

  clearStatus(providerId: string): void {
    delete this.data[providerId];
    this.save();
  }

  private load(): AuthData {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as AuthData;
    } catch {
      return {};
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
