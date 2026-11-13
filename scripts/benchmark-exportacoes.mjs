import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import electron from 'electron';
import { environment } from './env.mjs';
mkdirSync('.cache/export-benchmark-app', { recursive: true });
writeFileSync(
  '.cache/export-benchmark-app/package.json',
  JSON.stringify({
    name: 'mnr-export-benchmark',
    version: '0.1.0',
    main: '../../scripts/benchmark-exportacoes-main.cjs',
  }),
);
const child = spawn(electron, ['.cache/export-benchmark-app', ...process.argv.slice(2)], {
  env: environment(),
  stdio: 'inherit',
});
const timer = setTimeout(() => child.kill(), 300000);
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
