const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
test('SQLite creates and reopens a local database with safety pragmas and no business tables', () => {
  const root = resolve('.local-data');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'database-test-'));
  let db = openDatabase(directory);
  try {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get().count,
      0,
    );
  } finally {
    db.close();
  }
  db = openDatabase(directory);
  try {
    assert.equal(db.prepare('SELECT 1 AS ready').get().ready, 1);
  } finally {
    db.close();
  }
});
