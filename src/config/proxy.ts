export interface ProxySettings {
  server: string;
  username?: string;
  password?: string;
}

export interface ProxyInput {
  server?: string | null;
  username?: string | null;
  password?: string | null;
}

/**
 * Normalize proxy config from YAML / CLI / env.
 * Accepts server as "http://host:port" or "host:port".
 */
export function parseProxySettings(input: ProxyInput): ProxySettings | null {
  const raw = input.server?.trim();
  if (!raw) return null;

  // http://user:pass@host:port
  const withScheme = raw.includes('://') ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    const server = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
    const username = input.username?.trim() || url.username || undefined;
    const password = input.password?.trim() || url.password || undefined;

    if (!username && !password) {
      return { server };
    }
    return { server, username, password };
  } catch {
    return null;
  }
}

/** Playwright launch option (auth via separate fields). */
export function toPlaywrightProxy(proxy: ProxySettings): {
  server: string;
  username?: string;
  password?: string;
} {
  if (proxy.username) {
    return {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password ?? '',
    };
  }
  return { server: proxy.server };
}

/** Chrome CLI flag. Embeds credentials when present (CDP manual / auto-launch). */
export function toChromeProxyArg(proxy: ProxySettings): string {
  if (proxy.username) {
    const url = new URL(proxy.server);
    url.username = encodeURIComponent(proxy.username);
    if (proxy.password) url.password = encodeURIComponent(proxy.password);
    return `--proxy-server=${url.toString()}`;
  }
  return `--proxy-server=${proxy.server}`;
}

export function proxyDisplayLabel(proxy: ProxySettings): string {
  const url = new URL(proxy.server);
  const auth = proxy.username ? `${proxy.username}@` : '';
  return `${url.protocol}//${auth}${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}
