import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';
import electron from 'electron';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const source = JSON.parse(readFileSync('.cache/benchmark-financeiro.json', 'utf8'));
mkdirSync('.local-data/test', { recursive: true });
const dir = mkdtempSync(resolve('.local-data/test/ui-financeiro-benchmark-'));
mkdirSync(resolve(dir, 'data'));
const db = await openDatabase(source.directory, 'benchmark');
try {
  const histories = db
    .prepare(
      "SELECT d.id,count(m.id) movimentos FROM documentos d JOIN movimentos_financeiros m ON m.documento_id=d.id WHERE d.tipo='VENDA' GROUP BY d.id HAVING count(m.id)>=5 ORDER BY count(m.id)",
    )
    .all();
  writeFileSync(
    resolve(dir, 'fixture.json'),
    JSON.stringify({ source: source.directory, volumes: source.samples.at(-1), histories }),
  );
  await db.backup(resolve(dir, 'data/mnr-perfumes.db'));
} finally {
  db.close();
}
mkdirSync('.cache/financeiro-benchmark-app', { recursive: true });
writeFileSync(
  '.cache/financeiro-benchmark-app/package.json',
  JSON.stringify({
    name: 'mnr-financeiro-benchmark',
    version: '0.1.0',
    main: '../../scripts/benchmark-financeiro-ui-desktop.cjs',
  }),
);
const child = spawn(electron, ['.cache/financeiro-benchmark-app'], {
  stdio: 'inherit',
  env: environment({ MNR_UI_TEST_RUN: basename(dir), MNR_DEV: '0', MNR_SMOKE: '0' }),
});
const timer = setTimeout(() => child.kill(), 120000);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('exit', (code) => resolve(code ?? 1));
    child.once('error', reject);
  });
} finally {
  clearTimeout(timer);
}
