import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';
import electron from 'electron';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedReembolsos } = require('../tests/helpers/reembolsos-ui-fixture.cjs');
const development = process.argv.includes('--development');
mkdirSync('.local-data/test', { recursive: true });
const dir = mkdtempSync(resolve('.local-data/test/ui-reembolsos-'));
mkdirSync(resolve(dir, 'data'), { recursive: true });
const db = await openDatabase(resolve(dir, 'data'), 'test');
try {
  writeFileSync(resolve(dir, 'fixture.json'), JSON.stringify(seedReembolsos(db)));
} finally {
  db.close();
}
let server;
let child;
try {
  if (development) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: environment(),
    });
    let ready = false;
    for (let n = 0; n < 120; n++) {
      if (server.exitCode !== null) throw Error('Servidor encerrou');
      try {
        if ((await fetch('http://127.0.0.1:4200')).ok) {
          ready = true;
          break;
        }
      } catch {
        /*Aguardando servidor.*/
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw Error('Servidor indisponível');
  }
  mkdirSync('.cache/reembolsos-ui-app', { recursive: true });
  writeFileSync(
    '.cache/reembolsos-ui-app/package.json',
    JSON.stringify({
      name: 'mnr-reembolsos-test',
      version: '0.1.0',
      main: '../../scripts/reembolsos-ui-desktop.cjs',
    }),
  );
  for (const reopen of [false, true]) {
    child = spawn(electron, ['.cache/reembolsos-ui-app'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: environment({
        MNR_SMOKE: '0',
        MNR_DEV: development ? '1' : '0',
        MNR_UI_TEST_RUN: basename(dir),
        MNR_REEMBOLSOS_REOPEN: reopen ? '1' : '0',
        MNR_CONSOLIDACAO: process.argv.includes('--consolidacao') ? '1' : '0',
      }),
    });
    let passed = false;
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes('REEMBOLSOS_UI_OK')) passed = true;
    });
    const timer = setTimeout(() => {
      console.error('Financeiro UI timeout');
      child.kill();
    }, 180000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
      });
      if (code !== 0 || !passed) {
        process.exitCode = 1;
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
} finally {
  server?.kill();
  if (child && child.exitCode === null) child.kill();
}
