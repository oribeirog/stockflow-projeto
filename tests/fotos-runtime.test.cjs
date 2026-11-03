const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const electron = require('electron');
test('Electron photo codec, native cancellation, bounded files, tokens and secure IPC', async () => {
  const { environment } = await import('../scripts/env.mjs');
  const result = spawnSync(electron, ['scripts/fotos-runtime.cjs'], {
    env: environment(),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /FOTOS_RUNTIME_OK/);
});
