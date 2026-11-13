import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import electron from 'electron';
import { environment } from './env.mjs';
mkdirSync('.cache/backup-benchmark-app', { recursive: true });
writeFileSync(
  '.cache/backup-benchmark-app/package.json',
  JSON.stringify({
    name: 'mnr-backup-benchmark',
    version: '0.1.0',
    main: '../../scripts/benchmark-backup-restauracao-main.cjs',
  }),
);
const child = spawn(electron, ['.cache/backup-benchmark-app'], {
  env: environment(),
  stdio: 'inherit',
});
const timer = setTimeout(() => child.kill(), 600000);
child.once('exit', (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
