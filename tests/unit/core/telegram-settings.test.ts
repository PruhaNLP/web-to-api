import { describe, expect, it } from 'vitest';
import { buildTelegramSettingsView, mergeTelegramSettings, maskSecret } from '../../../src/core/error-notifier.js';
import {
  parseTelegramProxyFromBody,
  resolveTelegramProxy,
} from '../../../src/core/telegram-bot-api.js';

describe('telegram settings', () => {
  it('merges persisted settings with env override', () => {
    const merged = mergeTelegramSettings(
      {
        botToken: 'file-token',
        chatId: '111',
        proxy: { server: 'http://p.example:8000', username: 'u', password: 'p' },
      },
      {
        WTA_TELEGRAM_BOT_TOKEN: 'env-token',
        WTA_TELEGRAM_CHAT_ID: '',
      } as NodeJS.ProcessEnv,
    );
    expect(merged?.botToken).toBe('env-token');
    expect(merged?.chatId).toBe('111');
    expect(merged?.proxy?.server).toBe('http://p.example:8000');
  });

  it('prefers env proxy over persisted', () => {
    const proxy = resolveTelegramProxy(
      { proxy: { server: 'http://file:8000' } },
      {
        WTA_TELEGRAM_PROXY_SERVER: 'http://env:9000',
        WTA_TELEGRAM_PROXY_USER: 'user',
        WTA_TELEGRAM_PROXY_PASS: 'pass',
      } as NodeJS.ProcessEnv,
    );
    expect(proxy?.server).toBe('http://env:9000');
    expect(proxy?.username).toBe('user');
  });

  it('parses proxy from body and keeps saved password', () => {
    const parsed = parseTelegramProxyFromBody(
      { proxyServer: 'http://host:8000', proxyUser: 'u', proxyPass: '' },
      { server: 'http://old:8000', username: 'u', password: 'saved-pass' },
    );
    expect(parsed?.server).toBe('http://host:8000');
    expect(parsed?.password).toBe('saved-pass');
  });

  it('masks token for dashboard view', () => {
    expect(maskSecret('1234567890:ABCDEF')).toBe('1234…CDEF');
    const view = buildTelegramSettingsView(
      {
        botToken: '1234567890:ABCDEF',
        chatId: '42',
        proxy: { server: 'http://proxy:8000', username: 'u', password: 'longsecret123' },
      },
      {},
    );
    expect(view.configured).toBe(true);
    expect(view.proxy?.server).toBe('http://proxy:8000');
    expect(view.proxy?.passwordMasked).toBe('long…t123');
  });
});
