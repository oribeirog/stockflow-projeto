const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { join, resolve } = require('node:path');
const {
  migrations,
  migrateDatabase,
  inspectDatabase,
} = require('../dist/electron/infrastructure/database/migrate');
const { createCatalogService } = require('../dist/electron/services/catalogos');
const { createStockService } = require('../dist/electron/services/estoque');
const { createCommercialService } = require('../dist/electron/services/comercial');
const { reversaoAcumulada } = require('../dist/electron/domain/correcoes');
const { verifyFinanceiroRuntime } = require('./helpers/financeiro-runtime.cjs');
const cmd = (id, dados) => ({ operacaoId: id, motivo: 'Preservação', dados });
function snapshot(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]),
  );
}
async function seed(db, directory, version) {
  db.pragma('foreign_keys=ON');
  db.pragma('journal_mode=WAL');
  await migrateDatabase(
    db,
    { directory, existed: false, appVersion: 'old' },
    migrations.slice(0, version),
  );
  const c = createCatalogService(db, 'old');
  const b = c.saveReference('MARCA', cmd('b', { nome: 'Marca' }));
  const cat = c.saveReference('CATEGORIA', cmd('cat', { nome: 'Categoria' }));
  const p = c.saveProduct(
    cmd('p', {
      nome: 'Produto',
      sku: 'P',
      marcaId: b.id,
      categoriaId: cat.id,
      volumeMicrolitros: 1000,
      precoVendaCentavos: 100,
      estoqueMinimo: 0,
    }),
  );
  if (version >= 2)
    createStockService(db, 'old').registrarEntrada({
      ...cmd('stock', { produtoId: p.id, quantidade: 10, custoTotalCentavos: 100 }),
      dataEfetiva: '2026-10-31',
    });
  if (version >= 3) {
    const client = c.savePerson('CLIENTE', cmd('client', { nome: 'Cliente' }));
    const form = c.saveReference('FORMA_PAGAMENTO', cmd('form', { nome: 'Pix' }));
    const s = createCommercialService(db, 'old');
    for (const mode of ['A_VISTA', 'A_PRAZO']) {
      const d = s.salvarRascunho(
        cmd(`draft-${mode}`, {
          tipo: 'VENDA',
          clienteId: client.id,
          modalidadeVenda: mode,
          dataComercial: '2026-10-31',
          itens: [{ produtoId: p.id, quantidade: 1, valorUnitarioCentavos: 100 }],
        }),
      );
      s.confirmar(
        cmd(`confirm-${mode}`, {
          id: d.id,
          versaoEsperada: d.versao,
          ...(mode === 'A_VISTA'
            ? { pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 100 }] }
            : { parcelas: [{ valorCentavos: 100, vencimento: '2026-12-01' }] }),
        }),
      );
    }
  }
}
test('3D cumulative reversals conserve every independent component with nonnegative deltas', () => {
  for (let n = 1; n < 35; n++)
    for (let total = 0; total < 90; total++) {
      let sum = 0;
      for (let a = 0; a < n; a++) {
        const v = reversaoAcumulada(total, n, a, 1);
        assert.ok(v >= 0);
        sum += v;
        // Independent half-up bounds at each cumulative point.
        assert.ok(2 * total * (a + 1) >= (2 * sum - 1) * n);
        assert.ok(2 * total * (a + 1) < (2 * sum + 1) * n);
      }
      assert.equal(sum, total);
    }
});
for (const version of [1, 2, 3])
  test(`0004 preserves populated v${version} rows and sequences`, async () => {
    mkdirSync(resolve('.local-data/test'), { recursive: true });
    const directory = mkdtempSync(resolve('.local-data/test/financeiro-migration-'));
    const db = new Database(join(directory, 'db.sqlite'));
    try {
      await seed(db, directory, version);
      db.exec('UPDATE sqlite_sequence SET seq=seq+500');
      const before = snapshot(db);
      const protections = db
        .prepare(
          "SELECT type,name,sql FROM sqlite_schema WHERE type IN ('trigger','index') AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      const sequences = db.prepare('SELECT * FROM sqlite_sequence').all();
      await migrateDatabase(db, { directory, existed: true, appVersion: '3D' });
      for (const [name, rows] of Object.entries(before)) {
        const actual = db
          .prepare(`SELECT ${Object.keys(rows[0] ?? {}).join(',') || '*'} FROM ${name} ORDER BY 1`)
          .all();
        assert.deepEqual(
          name === 'schema_migrations' ? actual.slice(0, version) : actual,
          rows,
          name,
        );
      }
      for (const seq of sequences)
        assert.ok(
          db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(seq.name).seq >= seq.seq,
        );
      for (const protection of protections) {
        const actual = db
          .prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?')
          .get(protection.type, protection.name);
        assert.ok(actual, protection.name);
        if (protection.type === 'index')
          assert.equal(
            actual.sql.replace(/\s/g, ''),
            protection.sql.replace(/\s/g, ''),
            protection.name,
          );
      }
      assert.equal(inspectDatabase(db).version, 4);
      assert.deepEqual(db.pragma('foreign_key_check'), []);
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      db.close();
    }
  });
test('0004 interrupted reconstruction rolls back populated WAL database and schema', async () => {
  mkdirSync(resolve('.local-data/test'), { recursive: true });
  const directory = mkdtempSync(resolve('.local-data/test/financeiro-rollback-'));
  const path = join(directory, 'db.sqlite');
  let db = new Database(path);
  try {
    await seed(db, directory, 3);
    const before = snapshot(db);
    const schema = db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
    const seq = db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
    for (const marker of [
      'DROP TABLE documentos;',
      'DROP TABLE itens_documento;',
      'DROP TABLE movimentos_financeiros;',
      'DROP TABLE movimentacoes_estoque;',
      'CREATE TABLE reembolsos_cliente',
    ]) {
      const sql = migrations[3].sql;
      const index = sql.indexOf(marker);
      const end = sql.indexOf(';', index) + 1;
      const failing = {
        ...migrations[3],
        sql: sql.slice(0, end) + '\nSELECT * FROM injected_missing_table;\n' + sql.slice(end),
      };
      await assert.rejects(
        migrateDatabase(db, { directory, existed: true, appVersion: '3D' }, [
          ...migrations.slice(0, 3),
          failing,
        ]),
      );
      db.close();
      db = new Database(path);
      db.pragma('foreign_keys=ON');
      assert.deepEqual(snapshot(db), before);
      assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
      assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(), seq);
      assert.equal(inspectDatabase(db).version, 3);
    }
  } finally {
    db.close();
  }
});
test('3D shared Node/Electron acceptance verifies populated upgrades, failures, backups and full financial sequence', async () => {
  mkdirSync(resolve('.local-data/test'), { recursive: true });
  await verifyFinanceiroRuntime(mkdtempSync(resolve('.local-data/test/financeiro-runtime-')));
});
