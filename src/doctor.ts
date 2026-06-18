import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { platform, arch, release } from 'node:os';
import chalk from 'chalk';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export async function runDoctor(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 20) {
    results.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion} ✓` });
  } else {
    results.push({
      name: 'Node.js',
      status: 'fail',
      message: `${nodeVersion} (requires >= 20)`,
      fix: 'Install Node.js 20+ from https://nodejs.org/',
    });
  }

  // 2. Platform info
  const os = platform();
  const archInfo = arch();
  results.push({
    name: 'Platform',
    status: 'ok',
    message: `${os} ${archInfo} (${release()})`,
  });

  // 3. Chrome detection
  const chromePath = findChromePath();
  if (chromePath) {
    let versionInfo = '';
    try {
      versionInfo = ' — ' + execSync(`"${chromePath}" --version`, { encoding: 'utf-8' }).trim();
    } catch {
      // Version detection failed, but Chrome exists
    }
    results.push({ name: 'Chrome', status: 'ok', message: `Found at ${chromePath}${versionInfo}` });
  } else {
    results.push({
      name: 'Chrome',
      status: 'fail',
      message: 'Google Chrome not found',
      fix: os === 'win32'
        ? 'Install from https://www.google.com/chrome/'
        : os === 'darwin'
          ? 'Install: brew install --cask google-chrome'
          : 'Install: sudo apt install google-chrome-stable  OR  sudo dnf install google-chrome-stable',
    });
  }

  // 4. Playwright-core — check via dynamic import
  try {
    await import('playwright-core');
    results.push({ name: 'playwright-core', status: 'ok', message: 'Installed ✓' });
  } catch {
    results.push({
      name: 'playwright-core',
      status: 'fail',
      message: 'Not installed',
      fix: 'Run: npm install playwright-core',
    });
  }

  // 5. Port availability
  results.push({ name: 'Default Port', status: 'ok', message: '3456 (will auto-find if busy)' });

  // 6. Data directory
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const stateDir = `${homeDir}/.web-to-api`;
  results.push({
    name: 'Data Directory',
    status: 'ok',
    message: stateDir,
  });

  return results;
}

export function printDoctorResults(results: CheckResult[]): void {
  console.log('');
  console.log(chalk.bold('  web-to-api doctor'));
  console.log(chalk.gray('  ─────────────────────────'));
  console.log('');

  let hasFailure = false;
  for (const r of results) {
    const icon = r.status === 'ok' ? chalk.green('✓')
      : r.status === 'warn' ? chalk.yellow('⚠')
      : chalk.red('✗');
    console.log(`  ${icon} ${chalk.bold(r.name)}: ${r.message}`);
    if (r.fix) {
      console.log(chalk.gray(`    Fix: ${r.fix}`));
      hasFailure = true;
    }
  }

  console.log('');
  if (hasFailure) {
    console.log(chalk.yellow('  Some issues found. Fix them and try again.'));
  } else {
    console.log(chalk.green('  All checks passed! Ready to run.'));
  }
  console.log('');
}

export function findChromePath(): string | undefined {
  const os = platform();

  if (os === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  if (os === 'linux') {
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    // Try which
    try {
      return execSync('which google-chrome || which chromium || which chromium-browser', {
        encoding: 'utf-8',
      }).trim();
    } catch {
      // Not found
    }
  }

  if (os === 'win32') {
    const paths = [
      `${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES']}\\Chromium\\Application\\chrome.exe`,
    ];
    for (const p of paths) {
      if (p && existsSync(p)) return p;
    }
  }

  return undefined;
}
