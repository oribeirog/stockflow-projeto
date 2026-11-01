const { test } = require('node:test');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { verifyMigration, verifyMigrationRollback } = require('./helpers/comercial-migration.cjs');
function directory() {
  const root = resolve('.local-data/test');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'comercial-migration-'));
}
test('0003 preserves every V2 row, movement origins, triggers, indexes, FKs, sequence high-water mark and WAL backup', () =>
  verifyMigration(directory()));
test('0003 failures across reconstruction and deferred FK violation roll back schema, rows, sequences and markers', () =>
  verifyMigrationRollback(directory()));
