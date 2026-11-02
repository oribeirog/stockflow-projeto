const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const {
  migrations,
  migrateDatabase,
  inspectDatabase,
  checkIntegrity,
  APPLICATION_ID,
} = require('../dist/electron/infrastructure/database/migrate.js');
function directory() {
  const root = resolve('.local-data');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'migration-test-'));
}
const tables = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
const options = (dir) => ({ directory: dir, existed: true, appVersion: 'test' });
const fixture = (version, sql) => ({ version, name: `fixture-${version}`, sql });
const backups = (dir) => readdirSync(join(dir, 'backups')).filter((file) => file.endsWith('.db'));

test('3D schema contains only approved tables and all are STRICT', async () => {
  const db = await openDatabase(directory(), 'test');
  try {
    const expected = [
      'abatimentos_parcela',
      'alocacoes_recebimento',
      'alocacoes_reembolso',
      'categorias',
      'clientes',
      'documentos',
      'eventos_auditoria',
      'formas_pagamento',
      'fornecedores',
      'historico_precos',
      'itens_documento',
      'marcas',
      'metadados_banco',
      'movimentacoes_estoque',
      'movimentos_financeiros',
      'operacoes',
      'origens_reembolso',
      'parcelas_receber',
      'produtos',
      'reembolsos_cliente',
      'saldos_estoque',
      'schema_migrations',
      'vinculos_estoque_comercial',
    ];
    assert.deepEqual(tables(db), expected);
    assert.equal(db.pragma('application_id', { simple: true }), APPLICATION_ID);
    for (const table of db.pragma('table_list').filter((row) => expected.includes(row.name)))
      assert.equal(table.strict, 1);
    checkIntegrity(db);
  } finally {
    db.close();
  }
});
test('existing empty foundation database is backed up before first migration', async () => {
  const dir = directory();
  const original = new Database(join(dir, 'mnr-perfumes.db'));
  original.pragma('journal_mode = WAL');
  original.close();
  const db = await openDatabase(dir, 'test');
  try {
    assert.equal(backups(dir).length, 1);
    const path = join(dir, 'backups', backups(dir)[0]);
    const copy = new Database(path, { readonly: true });
    try {
      assert.deepEqual(tables(copy), []);
      checkIntegrity(copy);
    } finally {
      copy.close();
    }
    const manifest = JSON.parse(readFileSync(`${path}.json`, 'utf8'));
    assert.equal(manifest.schemaVersion, 0);
    assert.equal(manifest.targetSchemaVersion, 4);
    assert.equal(manifest.databaseId, null);
  } finally {
    db.close();
  }
});
test('unknown/future databases are rejected without changing the original file', async () => {
  for (const future of [false, true]) {
    const dir = directory();
    const file = join(dir, 'mnr-perfumes.db');
    const original = new Database(file);
    original.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserve')");
    if (future) {
      original.pragma(`application_id = ${APPLICATION_ID}`);
      original.pragma('user_version = 999');
    }
    original.close();
    const before = readFileSync(file);
    await assert.rejects(openDatabase(dir, 'test'), /desconhecido|incompatível/);
    assert.deepEqual(readFileSync(file), before);
  }
});
test('tampered checksum, incomplete history and invalid identity block opening and preserve records', async () => {
  for (const tampering of ['checksum', 'history', 'identity']) {
    const dir = directory();
    const db = await openDatabase(dir, 'test');
    db.exec("INSERT INTO marcas VALUES (1,'Preservar','PRESERVAR',1,'now','now')");
    if (tampering === 'checksum')
      db.exec(
        "DROP TRIGGER schema_migrations_imutavel; UPDATE schema_migrations SET checksum='tampered'",
      );
    else if (tampering === 'history')
      db.exec('DROP TRIGGER schema_migrations_sem_exclusao; DELETE FROM schema_migrations');
    else
      db.exec(
        "DROP TRIGGER metadados_banco_imutavel; UPDATE metadados_banco SET identificador='unknown'",
      );
    db.close();
    await assert.rejects(openDatabase(dir, 'test'), /inválido/);
    const raw = new Database(join(dir, 'mnr-perfumes.db'));
    try {
      assert.equal(raw.prepare('SELECT nome FROM marcas').get().nome, 'Preservar');
    } finally {
      raw.close();
    }
  }
});
test('upgrade from version 1 preserves data/IDs and creates consistent WAL backup with manifest', async () => {
  const dir = directory();
  const db = new Database(join(dir, 'mnr-perfumes.db'));
  db.pragma('foreign_keys=ON');
  db.pragma('trusted_schema=OFF');
  db.pragma('journal_mode=WAL');
  await migrateDatabase(db, { ...options(dir), existed: false }, migrations.slice(0, 1));
  try {
    db.exec("INSERT INTO marcas VALUES (8,'Preservar','PRESERVAR',1,'now','now')");
    const identity = inspectDatabase(db).identity;
    const future = migrations;
    await migrateDatabase(db, options(dir), future);
    assert.equal(db.pragma('user_version', { simple: true }), 4);
    assert.equal(inspectDatabase(db, future).identity.identificador, identity.identificador);
    assert.equal(db.prepare('SELECT nome FROM marcas WHERE id=8').get().nome, 'Preservar');
    const path = join(dir, 'backups', backups(dir)[0]);
    const copy = new Database(path, { readonly: true });
    try {
      checkIntegrity(copy);
      assert.equal(copy.pragma('user_version', { simple: true }), 1);
      assert.equal(copy.prepare('SELECT nome FROM marcas WHERE id=8').get().nome, 'Preservar');
      assert.equal(inspectDatabase(copy).identity.identificador, identity.identificador);
    } finally {
      copy.close();
    }
    const manifest = JSON.parse(readFileSync(`${path}.json`, 'utf8'));
    assert.equal(manifest.databaseId, identity.identificador);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.appVersion, 'test');
    await migrateDatabase(db, options(dir), future);
    assert.equal(backups(dir).length, 1);
  } finally {
    db.close();
  }
});
test('failure in pending set rolls back all migrations and markers', async () => {
  const dir = directory();
  const db = await openDatabase(dir, 'test');
  try {
    const identity = inspectDatabase(db).identity;
    await assert.rejects(
      migrateDatabase(db, options(dir), [
        ...migrations,
        fixture(5, 'CREATE TABLE rollback_marker(id INTEGER) STRICT;'),
        fixture(6, 'INSERT INTO nonexistent VALUES (1);'),
      ]),
      /nonexistent/,
    );
    assert.equal(db.pragma('user_version', { simple: true }), 4);
    assert.equal(tables(db).includes('rollback_marker'), false);
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, 4);
    assert.deepEqual(inspectDatabase(db).identity, identity);
    assert.equal(backups(dir).length, 1);
  } finally {
    db.close();
  }
});
test('failure during initial set restores pristine schema and application/user version', async () => {
  const dir = directory();
  const db = new Database(join(dir, 'fixture.db'));
  db.pragma('foreign_keys=ON');
  try {
    await assert.rejects(
      migrateDatabase(db, { ...options(dir), existed: false }, [
        ...migrations,
        fixture(5, 'INSERT INTO nonexistent VALUES (1)'),
      ]),
      /nonexistent/,
    );
    assert.deepEqual(tables(db), []);
    assert.equal(db.pragma('application_id', { simple: true }), 0);
    assert.equal(db.pragma('user_version', { simple: true }), 0);
  } finally {
    db.close();
  }
});
test('backup and manifest failures prevent migration', async () => {
  for (const failure of ['backup', 'directory', 'manifest']) {
    const dir = directory();
    const db = await openDatabase(dir, 'test');
    const originalBackup = db.backup;
    if (failure === 'directory') writeFileSync(join(dir, 'backups'), 'blocked');
    if (failure === 'backup')
      db.backup = async () => {
        throw new Error('backup failed');
      };
    if (failure === 'manifest')
      db.backup = async (path) => {
        const result = await originalBackup.call(db, path);
        writeFileSync(`${path}.json`, 'occupied');
        return result;
      };
    try {
      await assert.rejects(
        migrateDatabase(db, options(dir), [
          ...migrations,
          fixture(5, 'CREATE TABLE must_not_exist(id INTEGER) STRICT;'),
        ]),
      );
      assert.equal(db.pragma('user_version', { simple: true }), 4);
      assert.equal(tables(db).includes('must_not_exist'), false);
      checkIntegrity(db);
    } finally {
      db.close();
    }
  }
});
test('SQL rejects invalid STRICT types, FK, flags and mutation of technical history', async () => {
  const db = await openDatabase(directory(), 'test');
  try {
    assert.throws(() => db.exec("INSERT INTO marcas VALUES (1,'x','X',3,'now','now')"), /CHECK/);
    assert.throws(
      () => db.exec("INSERT INTO marcas VALUES (1,'x','X','not integer','now','now')"),
      /INTEGER/,
    );
    assert.throws(
      () =>
        db.exec(`INSERT INTO produtos
      (sku,nome,marca_id,categoria_id,volume_microlitros,preco_venda_centavos,estoque_minimo,ativo,criado_em,atualizado_em)
      VALUES ('x','x',999,999,1,0,0,1,'now','now')`),
      /FOREIGN KEY/,
    );
    assert.throws(() => db.exec('DELETE FROM metadados_banco'), /imutavel/);
    assert.throws(() => db.exec('UPDATE schema_migrations SET versao=2'), /imutavel/);
    assert.throws(
      () => db.exec("INSERT INTO operacoes VALUES ('bad','x','x','invalid json','now')"),
      /CHECK/,
    );
    checkIntegrity(db);
  } finally {
    db.close();
  }
});
