import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../../src/config/loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

describe('Config loader', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wmb-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig({ stateDir: testDir });
    expect(config.server.port).toBe(3456);
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.server.authToken).toBeNull();
    expect(config.server.openDashboard).toBe(true);
    expect(config.browser.profileDir).toBe(join(homedir(), 'web-to-api', 'chrome-profile'));
    expect(config.browser.startupTimeout).toBe(30000);
    expect(config.browser.idleShutdown).toBe(300);
    expect(config.browser.loginTimeout).toBe(180);
    expect(config.logging.level).toBe('info');
  });

  it('loads and merges YAML config', () => {
    const configPath = join(testDir, 'config.yml');
    writeFileSync(configPath, `
server:
  port: 8080
  authToken: "my-secret"
browser:
  idleShutdown: 60
logging:
  level: debug
`);
    const config = loadConfig({ stateDir: testDir });
    expect(config.server.port).toBe(8080);
    expect(config.server.authToken).toBe('my-secret');
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.browser.idleShutdown).toBe(60);
    expect(config.logging.level).toBe('debug');
  });

  it('CLI overrides take precedence over YAML', () => {
    const configPath = join(testDir, 'config.yml');
    writeFileSync(configPath, `
server:
  port: 8080
`);
    const config = loadConfig({ stateDir: testDir, port: 9999, host: '0.0.0.0' });
    expect(config.server.port).toBe(9999);
    expect(config.server.host).toBe('0.0.0.0');
  });

  it('handles invalid YAML gracefully', () => {
    const configPath = join(testDir, 'config.yml');
    writeFileSync(configPath, ': invalid: yaml: [[[');
    const config = loadConfig({ stateDir: testDir });
    expect(config.server.port).toBe(3456);
  });

  it('resolves log file relative to stateDir', () => {
    const config = loadConfig({ stateDir: '/custom/dir' });
    expect(config.logging.file).toBe('/custom/dir/logs/server.log');
  });

  it('uses default chrome profile outside dot-directories', () => {
    const config = loadConfig({ stateDir: '/custom/dir' });
    expect(config.browser.profileDir).toBe(join(homedir(), 'web-to-api', 'chrome-profile'));
  });

  it('providers.enabled defaults to supported providers', () => {
    const config = loadConfig({ stateDir: testDir });
    expect(config.providers.enabled).toEqual(['deepseek-web', 'kimi-web', 'qwen-web']);
    expect(config.providers.defaultModel).toBe('auto');
  });

  it('authToken override from CLI', () => {
    const config = loadConfig({ stateDir: testDir, authToken: 'cli-token' });
    expect(config.server.authToken).toBe('cli-token');
  });

  it('reads environment variables', () => {
    process.env.WTA_PORT = '9999';
    process.env.WTA_AUTH_TOKEN = 'env-token';
    try {
      const config = loadConfig({ stateDir: testDir });
      expect(config.server.port).toBe(9999);
      expect(config.server.authToken).toBe('env-token');
    } finally {
      delete process.env.WTA_PORT;
      delete process.env.WTA_AUTH_TOKEN;
    }
  });

  it('loads proxy from YAML', () => {
    const configPath = join(testDir, 'config.yml');
    writeFileSync(configPath, `
browser:
  proxy:
    server: http://168.80.81.65:8000
    username: testuser
    password: testpass
`);
    const config = loadConfig({ stateDir: testDir });
    expect(config.browser.proxy).toEqual({
      server: 'http://168.80.81.65:8000',
      username: 'testuser',
      password: 'testpass',
    });
  });

  it('CLI proxy overrides YAML', () => {
    const configPath = join(testDir, 'config.yml');
    writeFileSync(configPath, `
browser:
  proxy:
    server: http://1.1.1.1:1111
`);
    const config = loadConfig({
      stateDir: testDir,
      proxyServer: 'http://168.80.81.65:8000',
      proxyUser: 'cliuser',
      proxyPass: 'clipass',
    });
    expect(config.browser.proxy?.server).toBe('http://168.80.81.65:8000');
    expect(config.browser.proxy?.username).toBe('cliuser');
  });
});
