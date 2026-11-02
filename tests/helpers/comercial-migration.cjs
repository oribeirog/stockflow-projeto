const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { join } = require('node:path');
const { readdirSync, mkdtempSync } = require('node:fs');
const {
  migrateDatabase,
  migrations,
  inspectDatabase,
  checkIntegrity,
} = require('../../dist/electron/infrastructure/database/migrate.js');
const { createCatalogService } = require('../../dist/electron/services/catalogos.js');
const { createStockService } = require('../../dist/electron/services/estoque.js');
const {
  reconciliarComercial,
} = require('../../dist/electron/services/comercial-reconciliation.js');
const oldTables = [
  'marcas',
  'categorias',
  'formas_pagamento',
  'clientes',
  'fornecedores',
  'produtos',
  'historico_precos',
  'operacoes',
  'eventos_auditoria',
  'metadados_banco',
  'saldos_estoque',
  'movimentacoes_estoque',
  'schema_migrations',
];
const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
const objects = (db) =>
  db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
const cmd = (id, dados) => ({
  operacaoId: id,
  motivo: 'Preservar 3B',
  dataEfetiva: '2026-10-31',
  dados,
});
async function seedV2(db, directory) {
  db.pragma('foreign_keys=ON');
  db.pragma('trusted_schema=OFF');
  db.pragma('journal_mode=WAL');
  await migrateDatabase(
    db,
    { directory, existed: false, appVersion: '3B' },
    migrations.slice(0, 2),
  );
  const catalog = createCatalogService(db, '3B');
  const catcmd = (id, dados) => ({ operacaoId: id, motivo: 'Preservar 3B', dados });
  const brand = catalog.saveReference('MARCA', catcmd('brand', { nome: 'Marca' }));
  const category = catalog.saveReference('CATEGORIA', catcmd('category', { nome: 'Categoria' }));
  const product = catalog.saveProduct(
    catcmd('product', {
      nome: 'Preservado',
      sku: 'PRESERVAR',
      marcaId: brand.id,
      categoriaId: category.id,
      volumeMicrolitros: 1000,
      precoVendaCentavos: 100,
      estoqueMinimo: 0,
    }),
  );
  const stock = createStockService(db, '3B');
  const first = stock.registrarEntrada(
    cmd('entry', { produtoId: product.id, quantidade: 3, custoTotalCentavos: 100 }),
  );
  stock.registrarSaida(
    cmd('out', {
      produtoId: product.id,
      quantidade: 1,
      movimentacaoOrigemId: first.movimentacaoId,
    }),
  );
  stock.registrarEntrada(
    cmd('entry2', {
      produtoId: product.id,
      quantidade: 1,
      custoTotalCentavos: 10,
      movimentacaoOrigemId: first.movimentacaoId,
    }),
  );
  db.prepare("UPDATE sqlite_sequence SET seq=800 WHERE name='movimentacoes_estoque'").run();
  return product;
}
async function verifyMigration(directory) {
  const db = new Database(join(directory, 'upgrade-v2.db'));
  try {
    const product = await seedV2(db, directory);
    const snapshot = Object.fromEntries(oldTables.map((t) => [t, rows(db, t)]));
    const schema = objects(db),
      sequence = rows(db, 'sqlite_sequence'),
      foreignKeys = db.pragma('foreign_key_list(movimentacoes_estoque)');
    const identity = inspectDatabase(db).identity;
    await migrateDatabase(
      db,
      { directory, existed: true, appVersion: '3C' },
      migrations.slice(0, 3),
    );
    for (const table of oldTables) {
      let actual = rows(db, table);
      if (table === 'eventos_auditoria')
        actual = actual.map(({ documento_id, ...rest }) => {
          assert.equal(documento_id, null);
          return rest;
        });
      assert.deepEqual(
        actual,
        table === 'schema_migrations'
          ? snapshot[table].concat(rows(db, table).slice(2))
          : snapshot[table],
        table,
      );
    }
    assert.deepEqual(db.pragma('foreign_key_list(movimentacoes_estoque)'), foreignKeys);
    for (const object of schema.filter((o) => o.type === 'trigger' || o.type === 'index')) {
      assert.deepEqual(
        objects(db).find((o) => o.name === object.name),
        object,
        object.name,
      );
    }
    assert.deepEqual(rows(db, 'sqlite_sequence'), sequence);
    assert.deepEqual(inspectDatabase(db).identity, identity);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('defer_foreign_keys', { simple: true }), 0);
    assert.equal(reconciliarComercial(db), true);
    assert.equal(createStockService(db, 'test').reconciliarEstoque().consistente, true);
    assert.equal(rows(db, 'vinculos_estoque_comercial').length, 0);
    checkIntegrity(db);
    const backup = readdirSync(join(directory, 'backups')).find((n) => n.endsWith('.db'));
    const copy = new Database(join(directory, 'backups', backup), { readonly: true });
    try {
      assert.equal(copy.pragma('user_version', { simple: true }), 2);
      checkIntegrity(copy);
      assert.deepEqual(rows(copy, 'movimentacoes_estoque'), snapshot.movimentacoes_estoque);
    } finally {
      copy.close();
    }
    const result = createStockService(db, 'test').registrarEntrada(
      cmd('after-upgrade', { produtoId: product.id, quantidade: 1, custoTotalCentavos: 1 }),
    );
    assert.equal(result.movimentacaoId, 801);
  } finally {
    db.close();
  }
}
async function verifyMigrationRollback(directory) {
  const markers = [
    'DROP TRIGGER estoque_movimento_aplicar;',
    'FROM movimentacoes_estoque;',
    'DROP TABLE movimentacoes_estoque;',
    'ALTER TABLE movimentacoes_estoque_v3 RENAME TO movimentacoes_estoque;',
    'DROP TABLE estoque_sequencia_v3;',
    'ALTER TABLE eventos_auditoria ADD COLUMN documento_id INTEGER REFERENCES documentos(id) ON DELETE RESTRICT ON UPDATE RESTRICT;',
    migrations[2].sql.trimEnd().slice(-5),
  ];
  for (let i = 0; i <= markers.length; i++) {
    const failureDirectory = mkdtempSync(join(directory, 'rollback-'));
    const file = join(failureDirectory, 'existing-v2.db');
    let db = new Database(file);
    try {
      await seedV2(db, failureDirectory);
      const before = {
        schema: objects(db),
        rows: oldTables.map((t) => rows(db, t)),
        seq: rows(db, 'sqlite_sequence'),
        identity: inspectDatabase(db).identity,
      };
      let sql = migrations[2].sql;
      if (i === markers.length) {
        sql = sql.replace(
          'DROP TABLE movimentacoes_estoque;',
          'UPDATE movimentacoes_estoque_v3 SET movimentacao_origem_id=999 WHERE id=2;\nDROP TABLE movimentacoes_estoque;',
        );
      } else if (i === markers.length - 1) sql += '\nINSERT INTO nonexistent VALUES(1);';
      else {
        assert.ok(sql.includes(markers[i]), markers[i]);
        sql = sql.replace(markers[i], markers[i] + '\nINSERT INTO nonexistent VALUES(1);');
      }
      await assert.rejects(
        migrateDatabase(db, { directory: failureDirectory, existed: true, appVersion: 'test' }, [
          ...migrations.slice(0, 2),
          { ...migrations[2], sql },
        ]),
      );
      assert.equal(db.pragma('user_version', { simple: true }), 2);
      assert.deepEqual(objects(db), before.schema);
      assert.deepEqual(
        oldTables.map((t) => rows(db, t)),
        before.rows,
      );
      assert.deepEqual(rows(db, 'sqlite_sequence'), before.seq);
      assert.deepEqual(inspectDatabase(db).identity, before.identity);
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
      assert.equal(db.pragma('defer_foreign_keys', { simple: true }), 0);
      checkIntegrity(db);
      // Check durable rollback through a new connection, not only connection-local state.
      db.close();
      db = new Database(file);
      db.pragma('foreign_keys=ON');
      assert.equal(inspectDatabase(db).version, 2);
      assert.deepEqual(objects(db), before.schema);
      assert.deepEqual(
        oldTables.map((t) => rows(db, t)),
        before.rows,
      );
      assert.deepEqual(rows(db, 'sqlite_sequence'), before.seq);
      checkIntegrity(db);
      const backup = readdirSync(join(failureDirectory, 'backups')).find((n) => n.endsWith('.db'));
      assert.ok(backup);
      const copy = new Database(join(failureDirectory, 'backups', backup), { readonly: true });
      try {
        assert.equal(inspectDatabase(copy).version, 2);
        assert.deepEqual(
          oldTables.map((t) => rows(copy, t)),
          before.rows,
        );
        assert.deepEqual(rows(copy, 'sqlite_sequence'), before.seq);
      } finally {
        copy.close();
      }
    } finally {
      db.close();
    }
  }
}
module.exports = { verifyMigration, verifyMigrationRollback, seedV2 };
