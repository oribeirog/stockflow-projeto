const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const electron = require('electron');

test('Electron runtime supports STRICT schema, migrations, rollback, catalogs and consistent backup', async () => {
  const { environment } = await import('../scripts/env.mjs');
  const result = spawnSync(electron, ['scripts/database-runtime.cjs'], {
    env: environment(),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /DATABASE_RUNTIME_OK/);
  process.stdout.write(result.stdout);
});
