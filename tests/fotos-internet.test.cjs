const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
test('Internet photos: real Electron decodes WebP/JFIF, persists JPEG/PNG, rejects malformed/animated/oversized input without database writes', () => {
  const r = spawnSync(process.execPath, ['scripts/fotos-internet.mjs'], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /FOTOS_INTERNET_OK 10/);
});
