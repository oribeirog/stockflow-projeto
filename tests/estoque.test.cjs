const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { join, resolve } = require('node:path');
const Database = require('better-sqlite3');
const { fixture, command, cadastro } = require('./helpers/estoque-fixture.cjs');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const {
  createStockService,
  aplicarMovimentoNaTransacao,
} = require('../dist/electron/services/estoque.js');
const {
  migrateDatabase,
  migrations,
} = require('../dist/electron/infrastructure/database/migrate.js');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const code = (expected) => (error) => error.code === expected;
const counts = (db) =>
  ['operacoes', 'eventos_auditoria', 'movimentacoes_estoque'].map(
    (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,
  );

test('manual entries, partial exits, losses and depletion conserve exact residual cents', async (t) => {
  const { db, service, product } = await fixture(t);
  const produtoId = product.id;
  assert.deepEqual(service.consultarSaldo(produtoId), {
    produtoId,
    quantidade: 0,
    valorTotalCentavos: 0,
    versao: 0,
  });
  service.registrarEntrada(command({ produtoId, quantidade: 3, custoTotalCentavos: 100 }));
  service.registrarSaida(command({ produtoId, quantidade: 1 }));
  service.registrarPerda(command({ produtoId, quantidade: 1 }));
  service.registrarSaida(command({ produtoId, quantidade: 1 }));
  assert.deepEqual(
    service.listarMovimentacoes(produtoId).map((m) => m.valorDeltaCentavos),
    [100, -33, -34, -33],
  );
  assert.deepEqual(service.consultarSaldo(produtoId), {
    produtoId,
    quantidade: 0,
    valorTotalCentavos: 0,
    versao: 4,
  });
  const before = counts(db);
  assert.throws(
    () => service.registrarSaida(command({ produtoId, quantidade: 1 })),
    code('INSUFFICIENT_STOCK'),
  );
  assert.deepEqual(counts(db), before);
  assert.equal(service.reconciliarEstoque().consistente, true);
  assert.equal(db.pragma('trusted_schema', { simple: true }), 0);
});

test('weighted moving cost, free stock, history and deterministic conservation', async (t) => {
  const { service, product } = await fixture(t);
  const produtoId = product.id;
  service.registrarEntrada(command({ produtoId, quantidade: 2, custoTotalCentavos: 20000 }));
  service.registrarEntrada(command({ produtoId, quantidade: 1, custoTotalCentavos: 13000 }));
  service.registrarSaida(command({ produtoId, quantidade: 1 }));
  const original = service.listarMovimentacoes(produtoId)[2];
  assert.equal(original.valorDeltaCentavos, -11000);
  service.registrarEntrada(command({ produtoId, quantidade: 2, custoTotalCentavos: 0 }));
  assert.deepEqual(service.listarMovimentacoes(produtoId)[2], original);
  let seed = 23,
    inputQ = 5n,
    inputV = 33000n,
    outputQ = 1n,
    outputV = 11000n;
  for (let i = 0; i < 300; i++) {
    seed = (seed * 48271) % 2147483647;
    const before = service.consultarSaldo(produtoId);
    if (i % 3 === 0 || !before.quantidade) {
      const q = (seed % 7) + 1,
        v = seed % 101;
      service.registrarEntrada(command({ produtoId, quantidade: q, custoTotalCentavos: v }));
      inputQ += BigInt(q);
      inputV += BigInt(v);
    } else {
      const q = (seed % before.quantidade) + 1;
      service.registrarSaida(command({ produtoId, quantidade: q }));
      const after = service.consultarSaldo(produtoId);
      outputQ += BigInt(q);
      outputV += BigInt(before.valorTotalCentavos - after.valorTotalCentavos);
    }
    const after = service.consultarSaldo(produtoId);
    assert.equal(inputQ - outputQ, BigInt(after.quantidade));
    assert.equal(inputV - outputV, BigInt(after.valorTotalCentavos));
  }
  const rest = service.consultarSaldo(produtoId);
  if (rest.quantidade) service.registrarSaida(command({ produtoId, quantidade: rest.quantidade }));
  assert.equal(service.consultarSaldo(produtoId).valorTotalCentavos, 0);
  assert.equal(service.reconciliarEstoque().consistente, true);
});

test('counting supports inactive products, no difference, stale version, surplus and shortage', async (t) => {
  const { db, service, catalog, product, productData } = await fixture(t);
  const produtoId = product.id;
  catalog.saveProduct(cadastro({ ...productData, id: produtoId, ativo: false }));
  const noDifference = command({ produtoId, quantidadeContada: 0, versaoEsperada: 0 });
  const before = counts(db);
  const noResult = service.registrarContagem(noDifference);
  assert.equal(noResult.movimentacaoId, null);
  assert.deepEqual(counts(db), [before[0] + 1, before[1] + 1, before[2]]);
  assert.throws(
    () =>
      service.registrarContagem(command({ produtoId, quantidadeContada: 2, versaoEsperada: 0 })),
    code('VALIDATION'),
  );
  service.registrarContagem(
    command({ produtoId, quantidadeContada: 3, versaoEsperada: 0, custoTotalCentavos: 100 }),
  );
  assert.deepEqual(service.registrarContagem(noDifference), noResult);
  assert.throws(
    () =>
      service.registrarContagem(command({ produtoId, quantidadeContada: 2, versaoEsperada: 0 })),
    code('VERSION_CONFLICT'),
  );
  service.registrarContagem(command({ produtoId, quantidadeContada: 2, versaoEsperada: 1 }));
  assert.equal(service.consultarSaldo(produtoId).valorTotalCentavos, 67);
  service.registrarPerda(command({ produtoId, quantidade: 2 }));
  assert.equal(service.reconciliarEstoque().consistente, true);
});

test('validation, monetary/quantity bounds and idempotency reject without partial writes', async (t) => {
  const { db, service, product } = await fixture(t);
  const produtoId = product.id;
  const bad = [
    command({ produtoId, quantidade: 0, custoTotalCentavos: 1 }),
    command({ produtoId, quantidade: 1.5, custoTotalCentavos: 1 }),
    command({ produtoId, quantidade: 1, custoTotalCentavos: 9000000000001 }),
    command({ produtoId: Number.MAX_SAFE_INTEGER + 1, quantidade: 1, custoTotalCentavos: 0 }),
    command({ produtoId, quantidade: 1, custoTotalCentavos: 1, extra: 1 }),
    command({ produtoId, quantidade: 1, custoTotalCentavos: 1 }, { dataEfetiva: '2026-02-30' }),
    command({ produtoId, quantidade: 1, custoTotalCentavos: 1 }, { dataEfetiva: '2026-11-02' }),
    command({ produtoId, quantidade: 1, custoTotalCentavos: 1 }, { motivo: ' ' }),
  ];
  const before = counts(db);
  for (const cmd of bad) assert.throws(() => service.registrarEntrada(cmd), code('VALIDATION'));
  assert.deepEqual(counts(db), before);
  assert.throws(
    () =>
      service.registrarEntrada(command({ produtoId: 999, quantidade: 1, custoTotalCentavos: 1 })),
    code('NOT_FOUND'),
  );
  const cmd = command({ produtoId, quantidade: 1000000000, custoTotalCentavos: 9000000000000 });
  const result = service.registrarEntrada(cmd);
  assert.deepEqual(service.registrarEntrada(cmd), result);
  assert.throws(
    () => service.registrarEntrada({ ...cmd, motivo: 'Outro' }),
    code('IDEMPOTENCY_CONFLICT'),
  );
  assert.throws(
    () => service.registrarEntrada(command({ produtoId, quantidade: 1, custoTotalCentavos: 0 })),
    code('VALIDATION'),
  );
  service.registrarSaida(command({ produtoId, quantidade: 999999999 }));
  assert.equal(service.consultarSaldo(produtoId).valorTotalCentavos, 9000);
  const atLimit = counts(db);
  assert.throws(
    () =>
      service.registrarEntrada(
        command({ produtoId, quantidade: 1, custoTotalCentavos: 9000000000000 }),
      ),
    code('VALIDATION'),
  );
  assert.deepEqual(counts(db), atLimit);
  assert.equal(service.reconciliarEstoque().consistente, true);
});

test('one cent across three units permits zero-cost exits and exhausts exactly', async (t) => {
  const { service, product } = await fixture(t);
  const produtoId = product.id;
  service.registrarEntrada(command({ produtoId, quantidade: 3, custoTotalCentavos: 1 }));
  for (let i = 0; i < 3; i++) service.registrarSaida(command({ produtoId, quantidade: 1 }));
  assert.deepEqual(
    service.listarMovimentacoes(produtoId).map((m) => m.valorDeltaCentavos),
    [1, 0, -1, 0],
  );
  assert.equal(service.consultarSaldo(produtoId).valorTotalCentavos, 0);
  assert.equal(service.reconciliarEstoque().consistente, true);
});

test('SQL cannot mutate balances/history or bypass integer cost verification with trusted schema off', async (t) => {
  const { db, service, product } = await fixture(t);
  const produtoId = product.id;
  const entry = service.registrarEntrada(
    command({ produtoId, quantidade: 3, custoTotalCentavos: 100 }),
  );
  const before = service.consultarSaldo(produtoId);
  for (const sql of [
    'UPDATE saldos_estoque SET quantidade=2',
    'UPDATE saldos_estoque SET versao=versao+1',
    'DELETE FROM saldos_estoque',
    `INSERT OR REPLACE INTO saldos_estoque VALUES(${produtoId},0,0,0)`,
    `INSERT INTO saldos_estoque VALUES(${produtoId},0,0,0) ON CONFLICT DO UPDATE SET quantidade=0`,
    'UPDATE movimentacoes_estoque SET valor_delta_centavos=0',
    'DELETE FROM movimentacoes_estoque',
  ])
    assert.throws(() => db.exec(sql));
  const raw = db.prepare(`INSERT INTO movimentacoes_estoque
    (produto_id,natureza,quantidade_delta,valor_delta_centavos,quantidade_apos,valor_apos_centavos,versao_apos,motivo,data_efetiva,registrado_em,operacao_id,movimentacao_origem_id)
    VALUES (?,'AJUSTE_SAIDA',?,?,?,?,?,'SQL adversarial','2026-10-31','now',?,?)`);
  for (const args of [
    [-1, -32, 2, 68, 2, null],
    [-4, -100, 0, 0, 2, null],
    [-1, -33, 2, 67, 9, null],
    [-1, -33, 2, 67, 2, 999],
  ]) {
    assert.throws(() =>
      db
        .transaction(() => {
          db.prepare("INSERT INTO operacoes VALUES ('raw','TEST','hash','null','now')").run();
          raw.run(produtoId, ...args.slice(0, 5), 'raw', args[5]);
        })
        .immediate(),
    );
  }
  assert.throws(() =>
    db.exec(
      `INSERT OR REPLACE INTO movimentacoes_estoque SELECT * FROM movimentacoes_estoque WHERE id=${entry.movimentacaoId}`,
    ),
  );
  assert.deepEqual(service.consultarSaldo(produtoId), before);
  assert.throws(() => aplicarMovimentoNaTransacao(db, {}), code('INTEGRITY'));
});

test('failure injection at every write rolls back operation, movement, balance and audit', async (t) => {
  const { db, service, product } = await fixture(t);
  const produtoId = product.id;
  const stages = [
    ['AFTER INSERT', 'operacoes'],
    ['AFTER INSERT', 'movimentacoes_estoque'],
    ['AFTER UPDATE', 'saldos_estoque'],
    ['AFTER INSERT', 'eventos_auditoria'],
    ['BEFORE UPDATE', 'operacoes'],
  ];
  for (const [when, table] of stages) {
    const cmd = command({ produtoId, quantidade: 3, custoTotalCentavos: 100 });
    const before = counts(db),
      saldo = service.consultarSaldo(produtoId);
    db.exec(
      `CREATE TRIGGER injected_failure ${when} ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
    );
    assert.throws(() => service.registrarEntrada(cmd), code('INTEGRITY'));
    db.exec('DROP TRIGGER injected_failure');
    assert.deepEqual(counts(db), before);
    assert.deepEqual(service.consultarSaldo(produtoId), saldo);
    service.registrarEntrada(cmd);
    assert.equal(service.reconciliarEstoque().consistente, true);
  }
  const before = counts(db),
    saldo = service.consultarSaldo(produtoId);
  assert.throws(
    () =>
      db
        .transaction(() => {
          service.registrarEntrada(command({ produtoId, quantidade: 1, custoTotalCentavos: 1 }));
          service.registrarSaida(command({ produtoId, quantidade: 10000 }));
        })
        .immediate(),
    code('INSUFFICIENT_STOCK'),
  );
  assert.deepEqual(counts(db), before);
  assert.deepEqual(service.consultarSaldo(produtoId), saldo);
});

test('persistence and idempotent results survive reopen; corrupted balance blocks startup', async (t) => {
  const { db, directory, service, product } = await fixture(t);
  const cmd = command({ produtoId: product.id, quantidade: 3, custoTotalCentavos: 100 });
  const result = service.registrarEntrada(cmd),
    history = service.listarMovimentacoes(product.id);
  db.close();
  const reopened = await openDatabase(directory, 'test');
  try {
    const stock = createStockService(reopened, 'test');
    assert.deepEqual(stock.registrarEntrada(cmd), result);
    assert.deepEqual(stock.listarMovimentacoes(product.id), history);
    reopened.exec(
      'DROP TRIGGER estoque_saldo_protegido; UPDATE saldos_estoque SET valor_total_centavos=99',
    );
    // Restore the exact protection so schema inspection passes and reconciliation detects corruption.
    const trigger = migrations[1].sql.match(
      /CREATE TRIGGER estoque_saldo_protegido[\s\S]*?\nEND;/,
    )[0];
    reopened.exec(trigger);
    const report = stock.reconciliarEstoque();
    assert.equal(report.consistente, false);
    assert.deepEqual(report.divergencias[0], {
      produtoId: product.id,
      movimentacaoId: null,
      campo: 'valorTotalCentavos',
      esperado: '100',
      encontrado: '99',
    });
  } finally {
    reopened.close();
  }
  await assert.rejects(openDatabase(directory, 'test'), code('INTEGRITY'));
  const raw = new Database(join(directory, 'mnr-perfumes.db'));
  assert.equal(raw.prepare('SELECT valor_total_centavos v FROM saldos_estoque').get().v, 99);
  raw.close();
});

test('actual 3A product migration initializes zero without inventing movements or altering old rows', async (t) => {
  const { db, directory, productData } = await fixture(t);
  db.close();
  const path = join(directory, 'version-one.db');
  const old = new Database(path);
  old.pragma('foreign_keys=ON');
  old.pragma('trusted_schema=OFF');
  await migrateDatabase(
    old,
    { directory, existed: false, appVersion: '3A' },
    migrations.slice(0, 1),
  );
  const catalog = createCatalogService(old, '3A');
  catalog.saveReference('MARCA', cadastro({ nome: 'Marca' }));
  catalog.saveReference('CATEGORIA', cadastro({ nome: 'Categoria' }));
  const product = catalog.saveProduct(cadastro({ ...productData, ativo: false }));
  const oldTables = [
    'produtos',
    'historico_precos',
    'operacoes',
    'eventos_auditoria',
    'metadados_banco',
  ];
  const snapshot = oldTables.map((table) => old.prepare(`SELECT * FROM ${table}`).all());
  await migrateDatabase(old, { directory, existed: true, appVersion: '3B' });
  assert.deepEqual(
    oldTables.map((table) => old.prepare(`SELECT * FROM ${table}`).all()),
    snapshot,
  );
  const stock = createStockService(old, '3B');
  assert.deepEqual(stock.consultarSaldo(product.id), {
    produtoId: product.id,
    quantidade: 0,
    valorTotalCentavos: 0,
    versao: 0,
  });
  assert.equal(stock.listarMovimentacoes(product.id).length, 0);
  old.close();
});

async function race(directory, commands) {
  const gate = new SharedArrayBuffer(4);
  const workers = commands.map(
    (cmd) =>
      new Worker(resolve('tests/helpers/estoque-worker.cjs'), {
        workerData: { directory, gate, command: cmd },
      }),
  );
  const ready = workers.map(
    (w) =>
      new Promise((resolveReady, reject) => {
        w.once('message', resolveReady);
        w.once('error', reject);
      }),
  );
  const results = workers.map(
    (w) =>
      new Promise((resolveResult, reject) => {
        w.on('message', (message) => {
          if (!message.ready) resolveResult(message);
        });
        w.once('error', reject);
      }),
  );
  const exits = workers.map(
    (w) =>
      new Promise((resolveExit, reject) =>
        w.once('exit', (status) =>
          status ? reject(new Error(`Worker ${status}`)) : resolveExit(),
        ),
      ),
  );
  await Promise.all(ready);
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0);
  const output = await Promise.all(results);
  await Promise.all(exits);
  return output;
}

test('busy writer returns a retriable error without recording a provisional operation', async (t) => {
  const { db, directory, service, product } = await fixture(t);
  const locker = new Database(join(directory, 'mnr-perfumes.db'));
  db.pragma('busy_timeout=10');
  const cmd = command({ produtoId: product.id, quantidade: 1, custoTotalCentavos: 1 });
  const before = counts(db);
  try {
    locker.exec('BEGIN IMMEDIATE');
    assert.throws(() => service.registrarEntrada(cmd), code('BUSY'));
    assert.deepEqual(counts(db), before);
    locker.exec('ROLLBACK');
    service.registrarEntrada(cmd);
    assert.equal(service.consultarSaldo(product.id).quantidade, 1);
  } finally {
    if (locker.inTransaction) locker.exec('ROLLBACK');
    locker.close();
  }
});

test('reconciliation diagnoses missing balances, invalid versions and historical snapshots', async (t) => {
  const { db, service, product } = await fixture(t);
  const produtoId = product.id;
  service.registrarEntrada(command({ produtoId, quantidade: 3, custoTotalCentavos: 100 }));
  service.registrarSaida(command({ produtoId, quantidade: 1 }));
  db.exec('DROP TRIGGER estoque_saldo_protegido; UPDATE saldos_estoque SET versao=99');
  assert.ok(
    service
      .reconciliarEstoque()
      .divergencias.some((d) => d.campo === 'versao' && d.esperado === '2'),
  );
  db.exec(
    'UPDATE saldos_estoque SET versao=2; DROP TRIGGER estoque_movimento_imutavel; UPDATE movimentacoes_estoque SET valor_apos_centavos=101 WHERE versao_apos=1',
  );
  assert.ok(
    service
      .reconciliarEstoque()
      .divergencias.some((d) => d.campo === 'valorAposCentavos' && d.movimentacaoId === 1),
  );
  db.exec(
    'UPDATE movimentacoes_estoque SET valor_apos_centavos=100 WHERE versao_apos=1; DROP TRIGGER estoque_saldo_sem_exclusao; DELETE FROM saldos_estoque',
  );
  assert.ok(
    service
      .reconciliarEstoque()
      .divergencias.some((d) => d.campo === 'quantidade' && d.encontrado === 'null'),
  );
});

test('failure during actual stock migration rolls back tables and preserves version-one records', async (t) => {
  const { db, directory } = await fixture(t);
  db.close();
  const old = new Database(join(directory, 'failed-stock-migration.db'));
  old.pragma('foreign_keys=ON');
  old.pragma('trusted_schema=OFF');
  try {
    await migrateDatabase(
      old,
      { directory, existed: false, appVersion: '3A' },
      migrations.slice(0, 1),
    );
    old.exec("INSERT INTO marcas VALUES(55,'Preservar','PRESERVAR',1,'now','now')");
    const snapshot = old.prepare('SELECT * FROM metadados_banco').get();
    await assert.rejects(
      migrateDatabase(old, { directory, existed: true, appVersion: '3B' }, [
        migrations[0],
        { ...migrations[1], sql: migrations[1].sql + '\nINSERT INTO nonexistent VALUES(1);' },
      ]),
      /nonexistent/,
    );
    assert.equal(old.pragma('user_version', { simple: true }), 1);
    assert.equal(
      old.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='saldos_estoque'").get().n,
      0,
    );
    assert.equal(old.prepare('SELECT nome FROM marcas WHERE id=55').get().nome, 'Preservar');
    assert.deepEqual(old.prepare('SELECT * FROM metadados_banco').get(), snapshot);
    await migrateDatabase(old, { directory, existed: true, appVersion: '3B' });
    assert.equal(old.pragma('user_version', { simple: true }), 2);
  } finally {
    old.close();
  }
});

test(
  'independent connections serialize last-unit exits and concurrent idempotent retries',
  { timeout: 20000 },
  async (t) => {
    const { directory, service, product } = await fixture(t);
    const produtoId = product.id;
    service.registrarEntrada(command({ produtoId, quantidade: 1, custoTotalCentavos: 1 }));
    const results = await race(directory, [
      command({ produtoId, quantidade: 1 }),
      command({ produtoId, quantidade: 1 }),
    ]);
    assert.equal(results.filter((r) => r.result).length, 1);
    assert.equal(results.filter((r) => r.code === 'INSUFFICIENT_STOCK').length, 1);
    service.registrarEntrada(command({ produtoId, quantidade: 1, custoTotalCentavos: 1 }));
    const retry = command({ produtoId, quantidade: 1 });
    const same = await race(directory, [retry, retry]);
    assert.deepEqual(same[0].result, same[1].result);
    assert.ok(same[0].result);
    assert.equal(service.consultarSaldo(produtoId).versao, 4);
    assert.equal(service.reconciliarEstoque().consistente, true);
  },
);
