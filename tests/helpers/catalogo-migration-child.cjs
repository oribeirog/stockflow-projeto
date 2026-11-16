// Deliberate process loss inside the official 0006 transaction; test roots only.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  Database = require('better-sqlite3');
const root = path.resolve(process.argv[2]),
  rel = path.relative(path.resolve('.local-data/test'), root);
assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
const db = new Database(path.join(root, 'data/mnr-perfumes.db'));
db.pragma('foreign_keys=ON');
db.pragma('journal_mode=WAL');
const exec = db.exec;
db.exec = function (sql) {
  if (sql.includes('CREATE TEMP TABLE mnr_produtos_0006')) {
    const marker = 'DROP TABLE produtos;';
    const result = exec.call(db, sql.slice(0, sql.indexOf(marker) + marker.length));
    void result;
    process.exit(42);
  }
  return exec.call(db, sql);
};
require('../../dist/electron/infrastructure/database/migrate')
  .migrateDatabase(db, {
    directory: path.join(root, 'data'),
    imagesDirectory: path.join(root, 'images'),
    existed: true,
    appVersion: 'test',
  })
  .then(() => process.exit(43))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
