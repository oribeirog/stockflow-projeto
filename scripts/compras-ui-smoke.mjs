import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import electron from 'electron';
import { environment } from './env.mjs';
const development = process.argv.includes('--development');
let server;
if (development) {
  server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: environment(),
  });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Servidor Angular encerrou antes de iniciar.');
    try {
      const response = await fetch('http://127.0.0.1:4200/');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Aguardando servidor local. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) {
    server.kill();
    throw new Error('Servidor Angular indisponível.');
  }
}
mkdirSync('.local-data/test', { recursive: true });
const dir = mkdtempSync(resolve('.local-data/test/ui-compras-'));
mkdirSync('.cache/compras-ui-app', { recursive: true });
writeFileSync(
  '.cache/compras-ui-app/package.json',
  JSON.stringify({
    name: 'mnr-compras-test',
    version: '0.1.0',
    main: '../../scripts/compras-ui-desktop.cjs',
  }),
);
const child = spawn(electron, ['.cache/compras-ui-app'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: environment({
    MNR_SMOKE: '0',
    MNR_DEV: development ? '1' : '0',
    MNR_UI_TEST_RUN: basename(dir),
    MNR_COMPRAS_EXPECT_HTTP: development ? '1' : '0',
  }),
});
let passed = false;
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('COMPRAS_UI_OK')) passed = true;
});
const timer = setTimeout(() => {
  child.kill();
  console.error('Compras UI timeout');
  process.exitCode = 1;
}, 120000);
child.on('exit', (code) => {
  clearTimeout(timer);
  server?.kill();
  process.exitCode = code === 0 && passed ? 0 : 1;
});
child.on('error', (error) => {
  clearTimeout(timer);
  server?.kill();
  console.error(error);
  process.exitCode = 1;
});
