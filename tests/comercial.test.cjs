const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { resolve, join } = require('node:path');
const Database = require('better-sqlite3');
const { fixture, cadastro, command } = require('./helpers/estoque-fixture.cjs');
const { createCommercialService } = require('../dist/electron/services/comercial.js');
const { reconciliarComercial } = require('../dist/electron/services/comercial-reconciliation.js');
const {
  descontoCentavos,
  ratear,
  dividirParcelas,
} = require('../dist/electron/domain/comercial.js');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const code = (expected) => (e) => e.code === expected;
const cmd = (dados, extra = {}) => ({
  operacaoId: randomUUID(),
  motivo: 'Operação comercial de teste',
  dados,
  ...extra,
});
async function commercialFixture(t) {
  const f = await fixture(t);
  const supplier = f.catalog.savePerson('FORNECEDOR', cadastro({ nome: 'Fornecedor' }));
  const client = f.catalog.savePerson('CLIENTE', cadastro({ nome: 'Cliente sem CPF' }));
  const cash = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Dinheiro' }));
  const pix = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Pix' }));
  const second = f.catalog.saveProduct(
    cadastro({ ...f.productData, sku: 'SEGUNDO', nome: 'Outro perfume' }),
  );
  const service = createCommercialService(f.db, 'test', () => new Date('2026-11-01T15:00:00Z'));
  const item = (produtoId = f.product.id, quantidade = 3, valorUnitarioCentavos = 100) => ({
    produtoId,
    quantidade,
    valorUnitarioCentavos,
  });
  const save = (data = {}) =>
    service.salvarRascunho(
      cmd({
        tipo: 'COMPRA',
        fornecedorId: supplier.id,
        dataComercial: '2026-10-31',
        itens: [item()],
        ...data,
      }),
    );
  const confirm = (d, extra = {}) =>
    service.confirmar(
      cmd({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: [{ formaPagamentoId: cash.id, valorCentavos: d.totalCentavos }],
        ...extra,
      }),
    );
  return { ...f, commercial: service, supplier, client, cash, pix, second, item, save, confirm };
}
function snapshot(db) {
  return Object.fromEntries(
    [
      'documentos',
      'itens_documento',
      'parcelas_receber',
      'movimentos_financeiros',
      'alocacoes_recebimento',
      'vinculos_estoque_comercial',
      'saldos_estoque',
      'movimentacoes_estoque',
      'operacoes',
      'eventos_auditoria',
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
  );
}

test('financial golden examples and independent conservation/fraction bounds', () => {
  assert.deepEqual(ratear(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(ratear(7, [1, 2, 3]), [1, 2, 4]);
  assert.deepEqual(ratear(0, [0, 0]), [0, 0]);
  assert.throws(() => ratear(1, [0, 0]));
  assert.equal(descontoCentavos(101, { tipo: 'PONTOS_BASE', valor: 5000 }), 51);
  assert.equal(
    descontoCentavos(9_000_000_000_000, { tipo: 'PONTOS_BASE', valor: 9999 }),
    8_999_100_000_000,
  );
  assert.throws(() => descontoCentavos(1, { tipo: 'CENTAVOS', valor: 2 }));
  assert.deepEqual(dividirParcelas(100, 3), [34, 33, 33]);
  assert.deepEqual(dividirParcelas(1, 1), [1]);
  assert.throws(() => dividirParcelas(1, 2));
  let seed = 31;
  for (let i = 0; i < 800; i++) {
    seed = (seed * 48271) % 2147483647;
    const bases = [seed % 101, (seed * 3) % 103, (seed * 7) % 107, 0];
    const total = i % 5 === 0 ? 9_000_000_000_000 : seed % 10001;
    const result = ratear(total, bases),
      denominator = bases.reduce((a, b) => a + BigInt(b), 0n);
    assert.equal(
      result.reduce((a, b) => a + BigInt(b), 0n),
      BigInt(total),
    );
    // Every allocation is a floor or ceil of the exact rational share.
    for (let j = 0; j < bases.length; j++) {
      const difference = BigInt(result[j]) * denominator - BigInt(total) * BigInt(bases[j]);
      assert.ok(difference > -denominator && difference < denominator);
      if (bases[j] === 0) assert.equal(result[j], 0);
      if (difference > 0n) {
        for (let k = 0; k < bases.length; k++) {
          const other = BigInt(result[k]) * denominator - BigInt(total) * BigInt(bases[k]);
          if (other <= 0n) {
            // A rounded-up share must precede every unawarded share by remainder,
            // then original sequence. This checks the selection without sorting it.
            assert.ok(denominator - difference >= -other);
            if (denominator - difference === -other) assert.ok(j < k);
          }
        }
      }
    }
    const installments = dividirParcelas(total, Math.min(1 + (seed % 99), total));
    assert.equal(
      installments.reduce((a, b) => a + BigInt(b), 0n),
      BigInt(total),
    );
    assert.ok(Math.max(...installments) - Math.min(...installments) <= 1);
    assert.ok(installments.every((value, n) => n === 0 || installments[n - 1] >= value));
  }
});

test('every basis-point discount satisfies independent half-up bounds, including maximum money', () => {
  for (const base of [0, 1, 2, 3, 99, 100, 101, 9999, 9_000_000_000_000]) {
    for (let points = 0; points <= 10000; points++) {
      const discount = descontoCentavos(base, { tipo: 'PONTOS_BASE', valor: points });
      // Cross-multiplication characterizes nearest-cent rounding, with exact ties
      // rounded upwards. No division or production rounding helper in this oracle.
      const error = BigInt(discount) * 20000n - BigInt(base) * BigInt(points) * 2n;
      assert.ok(error > -10000n && error <= 10000n);
      assert.ok(Number.isSafeInteger(discount) && discount >= 0 && discount <= base);
      assert.equal(BigInt(base - discount) + BigInt(discount), BigInt(base));
    }
    for (const value of new Set([0, Math.min(1, base), base])) {
      assert.equal(descontoCentavos(base, { tipo: 'CENTAVOS', valor: value }), value);
    }
  }
});

test('purchase allocates discounts/shipping/expenses and pays multiple active forms atomically', async (t) => {
  const f = await commercialFixture(t);
  const d = f.save({
    itens: [
      { ...f.item(), desconto: { tipo: 'CENTAVOS', valor: 30 } },
      f.item(f.second.id, 2, 100),
    ],
    descontoGlobal: { tipo: 'CENTAVOS', valor: 47 },
    freteCentavos: 11,
    despesasDiretasCentavos: 5,
  });
  assert.equal(d.totalCentavos, 439);
  assert.equal(f.service.consultarSaldo(f.product.id).quantidade, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n, 0);
  const confirmed = f.confirm(d, {
    pagamentos: [
      { formaPagamentoId: f.cash.id, valorCentavos: 100 },
      { formaPagamentoId: f.pix.id, valorCentavos: 300 },
      { formaPagamentoId: f.cash.id, valorCentavos: 39 },
    ],
  });
  assert.equal(confirmed.estado, 'CONFIRMADO');
  assert.equal(confirmed.recebimentosEfetivosCentavos, 0);
  assert.equal(confirmed.saldoReceberCentavos, 0);
  assert.deepEqual(
    confirmed.itens.map((i) => [
      i.descontoGlobalRateadoCentavos,
      i.freteRateadoCentavos,
      i.despesasRateadasCentavos,
      i.valorCustoEstoqueCentavos,
    ]),
    [
      [27, 6, 3, 252],
      [20, 5, 2, 187],
    ],
  );
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n, 2);
  assert.equal(
    f.db.prepare('SELECT sum(valor_centavos) n FROM movimentos_financeiros').get().n,
    439,
  );
  assert.equal(f.db.prepare('SELECT count(*) n FROM parcelas_receber').get().n, 0);
  assert.equal(f.service.consultarSaldo(f.product.id).valorTotalCentavos, 252);
  assert.equal(f.service.consultarSaldo(f.second.id).valorTotalCentavos, 187);
  assert.equal(reconciliarComercial(f.db), true);
});

test('free acquisition uses quantities as allocation base; zero documents have no fictitious cash', async (t) => {
  const f = await commercialFixture(t);
  const d = f.save({
    itens: [f.item(f.product.id, 1, 0), f.item(f.second.id, 2, 0)],
    freteCentavos: 1,
    despesasDiretasCentavos: 2,
  });
  assert.deepEqual(
    d.itens.map((i) => [i.freteRateadoCentavos, i.despesasRateadasCentavos]),
    [
      [0, 1],
      [1, 1],
    ],
  );
  f.confirm(d);
  const free = f.save({ itens: [{ ...f.item(f.product.id, 1, 0), motivo: 'Bonificação' }] });
  f.confirm(free, { pagamentos: [] });
  const sale = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    modalidadeVenda: 'A_VISTA',
    itens: [{ ...f.item(f.product.id, 1, 0), motivo: 'Amostra promocional' }],
  });
  const sold = f.confirm(sale, { pagamentos: [] });
  assert.equal(sold.parcelas.length, 0);
  assert.equal(sold.recebimentosEfetivosCentavos, 0);
  assert.equal(reconciliarComercial(f.db), true);
});

test('cash sale receives exactly once; credit sale creates debt without cash, client CPF optional', async (t) => {
  const f = await commercialFixture(t);
  f.confirm(f.save());
  const cash = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    modalidadeVenda: 'A_VISTA',
    itens: [f.item(f.product.id, 1, 150)],
  });
  const sold = f.confirm(cash, {
    pagamentos: [
      { formaPagamentoId: f.cash.id, valorCentavos: 50 },
      { formaPagamentoId: f.pix.id, valorCentavos: 100 },
    ],
  });
  assert.equal(sold.parcelas.length, 1);
  assert.equal(sold.parcelas[0].vencimento, '2026-10-31');
  assert.equal(sold.recebimentosEfetivosCentavos, 150);
  assert.equal(sold.saldoReceberCentavos, 0);
  const credit = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    clienteId: f.client.id,
    modalidadeVenda: 'A_PRAZO',
    itens: [f.item(f.product.id, 2, 151)],
  });
  const received = f.confirm(credit, {
    pagamentos: [],
    parcelas: [
      { valorCentavos: 101, vencimento: '2026-11-01' },
      { valorCentavos: 201, vencimento: '2026-12-01' },
    ],
  });
  assert.equal(received.recebimentosEfetivosCentavos, 0);
  assert.equal(received.saldoReceberCentavos, 302);
  assert.equal(received.contraparteNome, 'Cliente sem CPF');
  assert.equal(received.contraparteDocumento, null);
  assert.equal(f.service.consultarSaldo(f.product.id).quantidade, 0);
  assert.equal(reconciliarComercial(f.db), true);
});

test('draft versions, editing, discard, immutable history and idempotency survive reopening', async (t) => {
  const f = await commercialFixture(t);
  const d = f.save();
  const edited = f.save({
    id: d.id,
    versaoEsperada: d.versao,
    itens: [f.item(f.product.id, 3, 101)],
  });
  assert.equal(edited.numero, d.numero);
  assert.throws(() => f.confirm(d), code('VERSION_CONFLICT'));
  const confirm = cmd({
    id: edited.id,
    versaoEsperada: edited.versao,
    pagamentos: [{ formaPagamentoId: f.cash.id, valorCentavos: 303 }],
  });
  const result = f.commercial.confirmar(confirm),
    before = snapshot(f.db);
  assert.deepEqual(f.commercial.confirmar(confirm), result);
  assert.deepEqual(snapshot(f.db), before);
  assert.throws(
    () => f.commercial.confirmar({ ...confirm, motivo: 'Outro' }),
    code('IDEMPOTENCY_CONFLICT'),
  );
  assert.throws(
    () => f.commercial.descartarRascunho(cmd({ id: result.id, versaoEsperada: result.versao })),
    code('INVALID_STATE'),
  );
  f.catalog.saveProduct(
    cadastro({ ...f.productData, id: f.product.id, nome: 'Novo nome', precoVendaCentavos: 999 }),
  );
  f.catalog.savePerson(
    'FORNECEDOR',
    cadastro({ id: f.supplier.id, nome: 'Novo fornecedor', ativo: false }),
  );
  assert.deepEqual(f.commercial.consultar(result.id), result);
  assert.deepEqual(f.commercial.confirmar(confirm), result);
  const empty = f.save({ fornecedorId: null, itens: [] });
  const discard = cmd({ id: empty.id, versaoEsperada: empty.versao });
  assert.equal(f.commercial.descartarRascunho(discard).estado, 'DESCARTADO');
  assert.deepEqual(f.commercial.descartarRascunho(discard), f.commercial.consultar(empty.id));
  f.db.close();
  const reopened = await openDatabase(f.directory, 'test');
  t.after(() => reopened.close());
  assert.deepEqual(createCommercialService(reopened, 'test').confirmar(confirm), result);
});

test('validation rejects malformed discounts, dates, payments and parcel plans without effects', async (t) => {
  const f = await commercialFixture(t);
  for (const extra of [
    { itens: [f.item(), f.item()] },
    { itens: [{ ...f.item(), quantidade: 1.5 }] },
    { dataComercial: '2026-02-30' },
    { dataComercial: '2099-01-01' },
    { descontoGlobal: { tipo: 'CENTAVOS', valor: 301 } },
    { descontoGlobal: { tipo: 'PONTOS_BASE', valor: 10001 } },
    { itens: [f.item(f.product.id, 1_000_000_000, 9_000_000_000_000)] },
    { itens: [f.item(f.product.id, 1, 9_000_000_000_000), f.item(f.second.id, 1, 1)] },
  ]) {
    const before = snapshot(f.db);
    assert.throws(() => f.save(extra), code('VALIDATION'));
    assert.deepEqual(snapshot(f.db), before);
  }
  const buy = f.save();
  for (const payments of [
    [],
    [{ formaPagamentoId: f.cash.id, valorCentavos: 299 }],
    [{ formaPagamentoId: f.cash.id, valorCentavos: 301 }],
    [{ formaPagamentoId: f.cash.id, valorCentavos: 0 }],
  ]) {
    const before = snapshot(f.db);
    assert.throws(() => f.confirm(buy, { pagamentos: payments }), code('VALIDATION'));
    assert.deepEqual(snapshot(f.db), before);
  }
  f.confirm(buy);
  const missingClient = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    modalidadeVenda: 'A_PRAZO',
    itens: [f.item(f.product.id, 1, 100)],
  });
  assert.throws(
    () =>
      f.confirm(missingClient, {
        pagamentos: [],
        parcelas: [{ valorCentavos: 100, vencimento: '2026-11-01' }],
      }),
    code('VALIDATION'),
  );
  const sale = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    clienteId: f.client.id,
    modalidadeVenda: 'A_PRAZO',
    itens: [f.item(f.product.id, 1, 100)],
  });
  for (const parcelas of [
    [],
    [{ valorCentavos: 99, vencimento: '2026-11-01' }],
    [{ valorCentavos: 100, vencimento: '2026-10-30' }],
    [{ valorCentavos: 100, vencimento: '2026-02-30' }],
    [{ valorCentavos: 0, vencimento: '2026-11-01' }],
  ]) {
    const before = snapshot(f.db);
    assert.throws(() => f.confirm(sale, { pagamentos: [], parcelas }), code('VALIDATION'));
    assert.deepEqual(snapshot(f.db), before);
  }
  assert.throws(
    () =>
      f.confirm(sale, {
        pagamentos: [{ formaPagamentoId: f.cash.id, valorCentavos: 1 }],
        parcelas: [{ valorCentavos: 100, vencimento: '2026-11-01' }],
      }),
    code('VALIDATION'),
  );
});

test('below-cost is checked per final net item; shortage in last product rolls back everything', async (t) => {
  const f = await commercialFixture(t);
  f.confirm(f.save());
  const low = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    modalidadeVenda: 'A_VISTA',
    itens: [f.item(f.product.id, 1, 100)],
    descontoGlobal: { tipo: 'CENTAVOS', valor: 1 },
  });
  let before = snapshot(f.db);
  assert.throws(() => f.confirm(low), code('BELOW_COST'));
  assert.deepEqual(snapshot(f.db), before);
  const shortage = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    modalidadeVenda: 'A_VISTA',
    itens: [f.item(f.product.id, 1, 150), f.item(f.second.id, 1, 150)],
  });
  before = snapshot(f.db);
  assert.throws(() => f.confirm(shortage), code('INSUFFICIENT_STOCK'));
  assert.deepEqual(snapshot(f.db), before);
  const justified = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    modalidadeVenda: 'A_VISTA',
    itens: [{ ...f.item(f.product.id, 1, 0), motivo: 'Promoção justificada' }],
  });
  assert.equal(f.confirm(justified, { pagamentos: [] }).itens[0].valorCustoEstoqueCentavos, 100);
});

test('inactive product, supplier, client and payment form block new confirmations', async (t) => {
  const f = await commercialFixture(t);
  const buy = f.save();
  f.catalog.saveReference(
    'FORMA_PAGAMENTO',
    cadastro({ id: f.cash.id, nome: 'Dinheiro', ativo: false }),
  );
  assert.throws(() => f.confirm(buy), code('INACTIVE_REFERENCE'));
  f.catalog.saveReference(
    'FORMA_PAGAMENTO',
    cadastro({ id: f.cash.id, nome: 'Dinheiro', ativo: true }),
  );
  f.catalog.savePerson(
    'FORNECEDOR',
    cadastro({ id: f.supplier.id, nome: 'Fornecedor', ativo: false }),
  );
  assert.throws(() => f.confirm(buy), code('INACTIVE_REFERENCE'));
  f.catalog.savePerson(
    'FORNECEDOR',
    cadastro({ id: f.supplier.id, nome: 'Fornecedor', ativo: true }),
  );
  f.confirm(buy);
  const sale = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    clienteId: f.client.id,
    modalidadeVenda: 'A_VISTA',
    itens: [f.item(f.product.id, 1, 100)],
  });
  f.catalog.savePerson('CLIENTE', cadastro({ id: f.client.id, nome: 'Cliente', ativo: false }));
  assert.throws(() => f.confirm(sale), code('INACTIVE_REFERENCE'));
  f.catalog.savePerson('CLIENTE', cadastro({ id: f.client.id, nome: 'Cliente', ativo: true }));
  f.catalog.saveProduct(cadastro({ ...f.productData, id: f.product.id, ativo: false }));
  assert.throws(() => f.confirm(sale), code('INACTIVE_REFERENCE'));
});

test('failures at every commercial write roll back all products, ledger, audit and operation; retry succeeds', async (t) => {
  const f = await commercialFixture(t);
  const cases = [
    ['AFTER UPDATE', 'itens_documento'],
    ['AFTER UPDATE', 'documentos'],
    ['AFTER INSERT', 'movimentacoes_estoque'],
    ['AFTER UPDATE', 'saldos_estoque'],
    ['AFTER INSERT', 'vinculos_estoque_comercial'],
    ['AFTER INSERT', 'movimentos_financeiros'],
    ['AFTER INSERT', 'eventos_auditoria'],
    ['BEFORE UPDATE', 'operacoes'],
  ];
  for (const [when, table] of cases) {
    const d = f.save({ itens: [f.item(), f.item(f.second.id)] }),
      before = snapshot(f.db);
    const c = cmd({
      id: d.id,
      versaoEsperada: d.versao,
      pagamentos: [{ formaPagamentoId: f.cash.id, valorCentavos: d.totalCentavos }],
    });
    f.db.exec(
      `CREATE TRIGGER commercial_failure ${when} ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`,
    );
    assert.throws(() => f.commercial.confirmar(c), code('INTEGRITY'));
    assert.deepEqual(snapshot(f.db), before);
    f.db.exec('DROP TRIGGER commercial_failure');
    assert.equal(f.commercial.confirmar(c).estado, 'CONFIRMADO');
  }
  for (const table of ['parcelas_receber', 'alocacoes_recebimento']) {
    const d = f.save({
        tipo: 'VENDA',
        fornecedorId: null,
        modalidadeVenda: 'A_VISTA',
        itens: [f.item(f.product.id, 1, 100)],
      }),
      before = snapshot(f.db);
    f.db.exec(
      `CREATE TRIGGER commercial_failure AFTER INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`,
    );
    assert.throws(() => f.confirm(d), code('INTEGRITY'));
    assert.deepEqual(snapshot(f.db), before);
    f.db.exec('DROP TRIGGER commercial_failure');
    f.confirm(d);
  }
  assert.equal(reconciliarComercial(f.db), true);
});

test('SQL cannot rewrite confirmed commercial history or add payments/allocations', async (t) => {
  const f = await commercialFixture(t);
  const d = f.confirm(f.save());
  for (const sql of [
    `UPDATE documentos SET total_centavos=1 WHERE id=${d.id}`,
    `DELETE FROM documentos WHERE id=${d.id}`,
    "UPDATE itens_documento SET motivo='x'",
    'DELETE FROM itens_documento',
    'UPDATE movimentos_financeiros SET valor_centavos=1',
    'DELETE FROM movimentos_financeiros',
    'UPDATE vinculos_estoque_comercial SET item_documento_id=999',
    'DELETE FROM vinculos_estoque_comercial',
    'INSERT OR REPLACE INTO documentos SELECT * FROM documentos',
    'INSERT OR REPLACE INTO itens_documento SELECT * FROM itens_documento',
    'INSERT OR REPLACE INTO movimentos_financeiros SELECT * FROM movimentos_financeiros',
    'INSERT OR REPLACE INTO vinculos_estoque_comercial SELECT * FROM vinculos_estoque_comercial',
    `INSERT INTO movimentos_financeiros(documento_id,natureza,sentido,valor_centavos,forma_pagamento_id,forma_pagamento_historica,data_efetiva,registrado_em,operacao_id)
      VALUES (${d.id},'PAGAMENTO_COMPRA','SAIDA',1,${f.cash.id},'Dinheiro','2026-10-31','now','${d.operacaoConfirmacaoId}')`,
  ]) {
    const before = snapshot(f.db);
    assert.throws(() => f.db.exec(sql));
    assert.deepEqual(snapshot(f.db), before);
  }
});

test('cost snapshots remain unchanged after later purchases and retroactive commercial dates', async (t) => {
  const f = await commercialFixture(t);
  f.confirm(f.save({ itens: [f.item(f.product.id, 3, 0)], freteCentavos: 100 }));
  const costs = [];
  for (let i = 0; i < 3; i++) {
    const d = f.save({
      tipo: 'VENDA',
      fornecedorId: null,
      modalidadeVenda: 'A_VISTA',
      itens: [f.item(f.product.id, 1, 100)],
    });
    costs.push(f.confirm(d).itens[0].valorCustoEstoqueCentavos);
  }
  assert.deepEqual(costs, [33, 34, 33]);
  const history = f.commercial.listar();
  f.confirm(f.save({ dataComercial: '2026-01-01', itens: [f.item(f.product.id, 1, 10000)] }));
  assert.deepEqual(f.commercial.listar({ limite: 4 }), history);
});

async function race(directory, commands) {
  const gate = new SharedArrayBuffer(4);
  const workers = commands.map(
    (command) =>
      new Worker(resolve('tests/helpers/comercial-worker.cjs'), {
        workerData: { directory, gate, command },
      }),
  );
  try {
    await Promise.all(
      workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.once('message', (m) => (m.ready ? resolve() : reject(Error('Not ready'))));
            w.once('error', reject);
          }),
      ),
    );
    const results = workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.once('message', resolve);
          w.once('error', reject);
        }),
    );
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
test('independent connections serialize last-unit sales and duplicate confirmations', async (t) => {
  const f = await commercialFixture(t);
  f.confirm(f.save({ itens: [f.item(f.product.id, 1, 100)] }));
  const sales = [0, 1].map(() =>
    f.save({
      tipo: 'VENDA',
      fornecedorId: null,
      modalidadeVenda: 'A_VISTA',
      itens: [f.item(f.product.id, 1, 100)],
    }),
  );
  const commands = sales.map((d) =>
    cmd({
      id: d.id,
      versaoEsperada: d.versao,
      pagamentos: [{ formaPagamentoId: f.cash.id, valorCentavos: 100 }],
    }),
  );
  const results = await race(f.directory, commands);
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'INSUFFICIENT_STOCK').length, 1);
  assert.equal(f.service.consultarSaldo(f.product.id).quantidade, 0);
  const winner = results.findIndex((r) => r.result);
  const before = snapshot(f.db),
    retries = await race(f.directory, [commands[winner], commands[winner]]);
  assert.deepEqual(
    retries.map((r) => r.result),
    [results[winner].result, results[winner].result],
  );
  assert.deepEqual(snapshot(f.db), before);
  const purchase = f.save({ itens: [f.item(f.product.id, 1, 100)] }),
    c = cmd({
      id: purchase.id,
      versaoEsperada: purchase.versao,
      pagamentos: [{ formaPagamentoId: f.cash.id, valorCentavos: 100 }],
    });
  const duplicate = await race(f.directory, [c, c]);
  assert.deepEqual(duplicate[0].result, duplicate[1].result);
  assert.equal(f.service.consultarSaldo(f.product.id).quantidade, 1);
  assert.equal(reconciliarComercial(f.db), true);
});
test('busy commercial writer is retriable without provisional operation or partial effects', async (t) => {
  const f = await commercialFixture(t),
    d = f.save(),
    c = cmd({
      id: d.id,
      versaoEsperada: d.versao,
      pagamentos: [{ formaPagamentoId: f.cash.id, valorCentavos: 300 }],
    }),
    before = snapshot(f.db);
  const lock = new Database(join(f.directory, 'mnr-perfumes.db'));
  t.after(() => lock.close());
  f.db.pragma('busy_timeout=20');
  lock.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => f.commercial.confirmar(c), code('BUSY'));
    assert.deepEqual(snapshot(f.db), before);
  } finally {
    lock.exec('ROLLBACK');
  }
  assert.equal(f.commercial.confirmar(c).estado, 'CONFIRMADO');
});
test('commercial reconciliation blocks opening after tampered historical cost and preserves the database', async (t) => {
  const f = await commercialFixture(t),
    d = f.confirm(f.save());
  const trigger = f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='itens_update'").get().sql;
  f.db.exec(
    `DROP TRIGGER itens_update; UPDATE itens_documento SET valor_custo_estoque_centavos=1 WHERE documento_id=${d.id}; ${trigger}`,
  );
  assert.equal(reconciliarComercial(f.db), false);
  f.db.close();
  await assert.rejects(openDatabase(f.directory, 'test'), /Reconciliação comercial/);
  const raw = new Database(join(f.directory, 'mnr-perfumes.db'));
  try {
    assert.equal(
      raw.prepare('SELECT valor_custo_estoque_centavos n FROM itens_documento').get().n,
      1,
    );
  } finally {
    raw.close();
  }
});

test('one-cent credit sale, exact monetary maximum and overflow leave no rounding gaps', async (t) => {
  const f = await commercialFixture(t);
  f.service.registrarEntrada(
    command({ produtoId: f.product.id, quantidade: 1, custoTotalCentavos: 0 }),
  );
  const penny = f.save({
    tipo: 'VENDA',
    fornecedorId: null,
    clienteId: f.client.id,
    modalidadeVenda: 'A_PRAZO',
    itens: [f.item(f.product.id, 1, 1)],
  });
  const sold = f.confirm(penny, {
    pagamentos: [],
    parcelas: [{ valorCentavos: 1, vencimento: '2026-11-01' }],
  });
  assert.equal(sold.totalCentavos, 1);
  assert.equal(sold.recebimentosEfetivosCentavos, 0);
  assert.equal(sold.saldoReceberCentavos, 1);
  const maximum = f.save({ itens: [f.item(f.product.id, 1, 9_000_000_000_000)] });
  f.confirm(maximum);
  const extra = f.save({ itens: [f.item(f.product.id, 1, 1)] }),
    before = snapshot(f.db);
  assert.throws(() => f.confirm(extra), code('VALIDATION'));
  assert.deepEqual(snapshot(f.db), before);
  assert.equal(reconciliarComercial(f.db), true);
});

test('SQL rejects forged confirmation, cross-sale allocation, over-allocation and operation replacement', async (t) => {
  const f = await commercialFixture(t);
  const buy = f.save();
  assert.throws(() =>
    f.db
      .prepare("UPDATE documentos SET estado='CONFIRMADO',versao=versao+1 WHERE id=?")
      .run(buy.id),
  );
  f.confirm(buy);
  const sales = [0, 1].map(() =>
    f.save({
      tipo: 'VENDA',
      fornecedorId: null,
      modalidadeVenda: 'A_VISTA',
      itens: [f.item(f.product.id, 1, 100)],
    }),
  );
  const confirmed = sales.map((d) => f.confirm(d));
  const movement = f.db
    .prepare('SELECT id FROM movimentos_financeiros WHERE documento_id=?')
    .get(confirmed[0].id);
  const before = snapshot(f.db);
  for (const parcela of confirmed.flatMap((d) => d.parcelas)) {
    assert.throws(() =>
      f.db
        .prepare(
          'INSERT INTO alocacoes_recebimento(movimento_financeiro_id,parcela_id,valor_centavos) VALUES (?,?,1)',
        )
        .run(movement.id, parcela.id),
    );
  }
  assert.throws(() =>
    f.db.exec('INSERT OR REPLACE INTO operacoes SELECT * FROM operacoes LIMIT 1'),
  );
  assert.throws(() =>
    f.db.exec('INSERT OR REPLACE INTO eventos_auditoria SELECT * FROM eventos_auditoria LIMIT 1'),
  );
  assert.deepEqual(snapshot(f.db), before);
});
