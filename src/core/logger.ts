import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ======Settings=========
const ANSI_RE = /\x1b\[[0-9;]*m/g;
// ======Settings=========

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let logFilePath: string | null = null;
let minLevel: LogLevel = 'info';
let hooked = false;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

function writeLine(level: LogLevel, args: unknown[]): void {
  if (!logFilePath || !shouldLog(level)) return;
  const msg = args.map(formatArg).join(' ');
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${stripAnsi(msg)}\n`;
  try {
    appendFileSync(logFilePath, line, { encoding: 'utf-8' });
  } catch {
    /* ignore write failures */
  }
}

function wrapConsoleMethod(name: 'log' | 'info' | 'warn' | 'error', level: LogLevel): void {
  const original = console[name].bind(console);
  console[name] = (...args: unknown[]) => {
    writeLine(level, args);
    original(...args);
  };
}

export function initFileLogger(filePath: string, level: LogLevel = 'info'): string {
  mkdirSync(dirname(filePath), { recursive: true });
  logFilePath = filePath;
  minLevel = level;

  appendFileSync(
    filePath,
    `\n${'='.repeat(72)}\n${new Date().toISOString()} [INFO] web-to-api started\n${'='.repeat(72)}\n`,
    { encoding: 'utf-8' },
  );

  if (!hooked) {
    wrapConsoleMethod('log', 'info');
    wrapConsoleMethod('info', 'info');
    wrapConsoleMethod('warn', 'warn');
    wrapConsoleMethod('error', 'error');
    process.on('uncaughtException', (err) => {
      writeLine('error', [`uncaughtException: ${err.stack || err.message}`]);
    });
    process.on('unhandledRejection', (reason) => {
      writeLine('error', [`unhandledRejection: ${formatArg(reason)}`]);
    });
    hooked = true;
  }

  return filePath;
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

export function tailLogFile(filePath: string, lines: number): string {
  if (!existsSync(filePath)) return '';
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n').slice(-Math.max(1, lines)).join('\n');
}
