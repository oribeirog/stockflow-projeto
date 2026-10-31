import { spawn } from 'node:child_process';
import electron from 'electron';
import { environment } from './env.mjs';
const target = process.argv[2];
let passed = false;
const child = spawn(target ?? electron, target ? [] : ['.'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: environment({ MNR_SMOKE: '1' }),
});
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('SMOKE_OK')) passed = true;
});
const timer = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
  console.error('Smoke timeout');
}, 30000);
child.on('error', (error) => {
  console.error(error);
  clearTimeout(timer);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exitCode = code === 0 && passed ? 0 : 1;
});
