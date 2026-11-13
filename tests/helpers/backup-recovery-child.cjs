// Process-loss harness only. No fault switch is built into production modules.
const { resolve, relative, isAbsolute } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(process.argv[2]),
  phase = process.argv[3];
const rel = relative(resolve('.local-data/test'), root);
assert(rel && !rel.startsWith('..') && !isAbsolute(rel));
const io = require('../../dist/electron/services/backup/io');
const control = require('../../dist/electron/services/backup/control');
const original = io.durableJson,
  p = control.recoveryPaths(root);
io.durableJson = async function (path, ...args) {
  if (phase === 'before-pointer' && path === p.active) process.exit(42);
  const r = await original(path, ...args);
  if (phase === 'after-pointer' && path === p.active) process.exit(42);
  if (phase === 'after-commit' && path.endsWith('.done.json')) process.exit(42);
  return r;
};
if (phase === 'after-open') {
  const infrastructure = require('../../dist/electron/infrastructure/database'),
    open = infrastructure.openDatabase;
  infrastructure.openDatabase = async function (...args) {
    await open(...args);
    process.exit(42);
  };
}
control
  .recoverAndOpen(root, 'test')
  .then((r) => {
    r.db.close();
    process.exit(phase === 'complete' ? 0 : 43);
  })
  .catch((e) => {
    console.error(e.code ?? e.message);
    process.exit(1);
  });
