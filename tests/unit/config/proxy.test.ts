import { describe, it, expect } from 'vitest';
import {
  parseProxySettings,
  toPlaywrightProxy,
  toChromeProxyArg,
  proxyDisplayLabel,
} from '../../../src/config/proxy.js';

describe('proxy config', () => {
  it('parses host:port shorthand', () => {
    const p = parseProxySettings({ server: '168.80.81.65:8000' });
    expect(p).toEqual({ server: 'http://168.80.81.65:8000' });
  });

  it('parses server with separate credentials', () => {
    const p = parseProxySettings({
      server: 'http://168.80.81.65:8000',
      username: 'jyLvk9',
      password: 'Kbphfm',
    });
    expect(p).toEqual({
      server: 'http://168.80.81.65:8000',
      username: 'jyLvk9',
      password: 'Kbphfm',
    });
  });

  it('extracts credentials from server URL', () => {
    const p = parseProxySettings({ server: 'http://user:pass@1.2.3.4:8080' });
    expect(p?.username).toBe('user');
    expect(p?.password).toBe('pass');
    expect(p?.server).toBe('http://1.2.3.4:8080');
  });

  it('builds Playwright proxy option', () => {
    const p = parseProxySettings({
      server: 'http://168.80.81.65:8000',
      username: 'jyLvk9',
      password: 'Kbphfm',
    })!;
    expect(toPlaywrightProxy(p)).toEqual({
      server: 'http://168.80.81.65:8000',
      username: 'jyLvk9',
      password: 'Kbphfm',
    });
  });

  it('builds Chrome proxy arg with auth', () => {
    const p = parseProxySettings({
      server: 'http://168.80.81.65:8000',
      username: 'jyLvk9',
      password: 'Kbphfm',
    })!;
    expect(toChromeProxyArg(p)).toBe('--proxy-server=http://jyLvk9:Kbphfm@168.80.81.65:8000/');
  });

  it('masks password in display label', () => {
    const p = parseProxySettings({
      server: 'http://168.80.81.65:8000',
      username: 'jyLvk9',
      password: 'Kbphfm',
    })!;
    expect(proxyDisplayLabel(p)).toBe('http://jyLvk9@168.80.81.65:8000');
  });
});
