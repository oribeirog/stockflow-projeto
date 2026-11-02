import { spawn } from 'node:child_process';
import electron from 'electron';
import { environment } from './env.mjs';
let output = '';
const child = spawn(electron, ['scripts/cadastros-desktop.cjs'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: environment(),
});
child.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode =
    code === 0 && output.includes('development-origin UUID') && output.includes('mnr-origin UUID')
      ? 0
      : 1;
});
