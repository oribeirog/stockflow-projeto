import { spawn } from 'node:child_process';
import electron from 'electron';
import { environment } from './env.mjs';
import { resolve, join, basename } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { prepararVinculos, snapshotVinculos, conferirVinculos } = require('./pessoas-fixture.cjs');
const repository = resolve('.');
const target = process.argv[2];
const development = target === '--development';
mkdirSync('.local-data/test', { recursive: true });
const directory = mkdtempSync(
  resolve(development ? '.local-data/test/ui-dev-4c-' : '.local-data/test/smoke-4c-'),
);
const dataDirectory = join(directory, development ? 'data' : '.local-data/test/data');
mkdirSync(dataDirectory, { recursive: true });
const fixture = await openDatabase(dataDirectory, 'smoke-4c');
prepararVinculos(fixture);
const before = snapshotVinculos(fixture);
fixture.close();
let passed = false;
let peoplePassed = false;
const child = spawn(
  development ? process.execPath : target ? resolve(target) : electron,
  development ? [resolve('scripts/dev.mjs')] : target ? [] : [repository],
  {
    cwd: development ? repository : directory,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: environment({
      MNR_SMOKE: '1',
      MNR_DEV: '0',
      MNR_UI_TEST_RUN: development ? basename(directory) : '',
    }),
  },
);
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('SMOKE_OK')) passed = true;
  if (chunk.toString().includes(development ? 'PESSOAS_DEVELOPMENT_OK' : 'PESSOAS_OFFLINE_OK'))
    peoplePassed = true;
});
const timer = setTimeout(
  () => {
    child.kill();
    process.exitCode = 1;
    console.error('Smoke timeout');
  },
  development ? 120000 : 30000,
);
child.on('error', (error) => {
  console.error(error);
  clearTimeout(timer);
  process.exitCode = 1;
});
child.on('exit', async (code) => {
  clearTimeout(timer);
  try {
    const inspection = await openDatabase(dataDirectory, 'smoke-4c');
    try {
      conferirVinculos(inspection, before);
      if (code === 0 && passed && peoplePassed) console.log('PESSOAS_ISOLATED_OK', directory);
    } finally {
      inspection.close();
    }
    process.exitCode = code === 0 && passed && peoplePassed ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
