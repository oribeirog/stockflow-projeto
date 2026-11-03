const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
test('SQLite creates and reopens the versioned 3D schema with safety pragmas', async () => {
  const root = resolve('.local-data');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'database-test-'));
  let db = await openDatabase(directory, 'test');
  let identity;
  try {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    assert.equal(db.pragma('user_version', { simple: true }), 5);
    assert.equal(db.pragma('trusted_schema', { simple: true }), 0);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    identity = db.prepare('SELECT * FROM metadados_banco').get();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 5);
  } finally {
    db.close();
  }
  db = await openDatabase(directory, 'test');
  try {
    assert.equal(db.prepare('SELECT 1 AS ready').get().ready, 1);
    assert.deepEqual(db.prepare('SELECT * FROM metadados_banco').get(), identity);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 5);
  } finally {
    db.close();
  }
});
