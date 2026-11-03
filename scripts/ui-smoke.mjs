import { spawn } from 'node:child_process';
import electron from 'electron';
import { environment } from './env.mjs';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

mkdirSync('.local-data/test', { recursive: true });
const testRoot = mkdtempSync(resolve('.local-data/test/ui-'));
const development = resolve('.local-data/development/data/mnr-perfumes.db');
const fingerprint = () =>
  existsSync(development)
    ? createHash('sha256').update(readFileSync(development)).digest('hex')
    : null;
const before = fingerprint();

// A package entry keeps app.getVersion() consistent with the normal application.
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mkdirSync('.cache/ui-app', { recursive: true });
writeFileSync(
  '.cache/ui-app/package.json',
  JSON.stringify({
    name: packageInfo.name,
    version: packageInfo.version,
    main: '../../scripts/ui-desktop.cjs',
  }),
);

let passed = false;
const child = spawn(electron, ['.cache/ui-app'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: environment({ MNR_SMOKE: '0', MNR_DEV: '0', MNR_UI_TEST_RUN: basename(testRoot) }),
});
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('DESKTOP_UI_OK')) passed = true;
});
const timer = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
  console.error('Desktop UI timeout');
}, 180000);
child.on('error', (error) => {
  clearTimeout(timer);
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timer);
  const unchanged = before === fingerprint();
  if (!unchanged) console.error('Development database changed during UI test');
  process.exitCode = code === 0 && passed && unchanged ? 0 : 1;
});
