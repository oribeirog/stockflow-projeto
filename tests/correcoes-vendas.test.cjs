const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { seedCorrecoes } = require('./helpers/correcoes-ui-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { criarHandlersConsultasFinanceiras } = require('../dist/electron/ipc/financeiro');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const clock = () => new Date('2026-11-05T15:00:00Z');
async function setup(t) {
  const f = await fixture(t),
    ids = seedCorrecoes(f.db);
  const handlers = criarHandlersConsultasFinanceiras(f.db, clock, 'test-correcoes');
  const call = (m, v) => handlers.get('correcoes:' + m)(v);
  const ok = (m, v) => {
    const r = call(m, v);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const data = (sale = ids.main, q = 1, loss = 0) => ({
    documentoId: sale.id,
    dataEfetiva: '2026-11-01',
    itens: [{ itemId: sale.itens[0].id, quantidade: q, quantidadePerda: loss }],
  });
  const command = (dados, cancel = false) => ({
    operacaoId: randomUUID(),
    motivo: 'Correção de teste',
    dados,
    revisao: ok(cancel ? 'revisar-cancelamento-venda' : 'revisar-devolucao-venda', {
      motivo: 'Correção de teste',
      dados,
    }).revisao,
  });
  return { ...f, ids, handlers, call, ok, data, command };
}

test('4E2C: query_only review; mixed historical return; required 300/100/150/200 scenario and immutable snapshots', async (t) => {
  const s = await setup(t),
    dados = s.data(s.ids.entry, 2, 1),
    before = snapshot(s.db);
  const balance = s.service.consultarSaldo(s.ids.productId);
  s.db.pragma('query_only=ON');
  const review = s.ok('revisar-devolucao-venda', { motivo: 'Correção de teste', dados });
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
  assert.equal(review.valorCentavos, 20000);
  assert.equal(review.resumoAnterior.recebimentosEfetivosCentavos, 25000);
  assert.equal(review.resumoAnterior.saldoReceberCentavos, 5000);
  assert.equal(review.comercialPrevistoCentavos, 10000);
  assert.equal(review.saldoPrevistoCentavos, 0);
  assert.equal(review.reembolsoCriadoCentavos, 15000);
  assert.equal(review.itens[0].descricao, 'Perfume recebimentos');
  assert.equal(review.itens[0].sku, 'REC');
  assert.deepEqual(
    review.estoque.map((m) => [m.quantidadeDelta, m.valorDeltaCentavos]),
    [
      [1, 10],
      [1, 10],
      [-1, -10],
    ],
  );
  const r = s.ok('devolver-venda', s.command(dados));
  assert.equal(r.financeiro.reembolsosPendentesCentavos, 15000);
  assert.equal(r.financeiro.reembolsosPagosCentavos, 0);
  const after = s.service.consultarSaldo(s.ids.productId);
  assert.equal(after.quantidade, balance.quantidade + 1);
  assert.equal(after.valorTotalCentavos, balance.valorTotalCentavos + 10);
  const doc = s.ok('obter-documento', { vendaId: s.ids.entry.id, documentoId: r.documentoId });
  assert.equal(doc.movimentosEstoque.length, 3);
  assert.equal(doc.itens[0].quantidadePerda, 1);
  assert.equal(s.ok('obter-contexto-venda', s.ids.entry.id).itens[0].quantidadeDisponivel, 1);
});

test('4E2C: successive returns, all remaining units, cancellation allowed and blocked after return', async (t) => {
  const s = await setup(t);
  s.ok('devolver-venda', s.command(s.data()));
  const c = s.ok('obter-contexto-venda', s.ids.main.id);
  assert.equal(c.cancelavel, false);
  assert.equal(c.itens[0].quantidadeDisponivel, 2);
  assert.equal(
    s.call('revisar-cancelamento-venda', {
      motivo: 'Teste',
      dados: { documentoId: s.ids.main.id, dataEfetiva: '2026-11-01' },
    }).error.code,
    'INVALID_STATE',
  );
  s.ok('devolver-venda', s.command(s.data(s.ids.main, 2)));
  assert.equal(s.ok('obter-contexto-venda', s.ids.main.id).itens[0].quantidadeDisponivel, 0);
  const cancel = { documentoId: s.ids.other.id, dataEfetiva: '2026-11-01' };
  s.db.pragma('query_only=ON');
  const r = s.ok('revisar-cancelamento-venda', { motivo: 'Teste', dados: cancel });
  s.db.pragma('query_only=OFF');
  assert.equal(r.valorCentavos, 30000);
  const command = s.command(cancel, true),
    result = s.ok('cancelar-venda', command),
    after = snapshot(s.db);
  assert.equal(result.financeiro.saldoReceberCentavos, 0);
  assert.deepEqual(s.ok('cancelar-venda', command), result);
  assert.equal(snapshot(s.db), after);
  assert.equal(s.ok('obter-contexto-venda', s.ids.other.id).vendaEstado, 'ESTORNADO');
});

test('4E2C: invalid arity, fields, dates, UUID, impression, crossed items and quantities preserve every table', async (t) => {
  const s = await setup(t),
    before = snapshot(s.db),
    data = s.data();
  for (const m of [
    'revisar-devolucao-venda',
    'revisar-cancelamento-venda',
    'devolver-venda',
    'cancelar-venda',
  ])
    for (const args of [[], [null], [{}, {}]])
      assert.equal(s.handlers.get('correcoes:' + m)(...args).ok, false);
  for (const dados of [
    { ...data, pagamentos: [] },
    { ...data, documentoId: '1' },
    { ...data, dataEfetiva: '2026-02-30' },
    { ...data, dataEfetiva: '2099-01-01' },
    { ...data, dataEfetiva: '2026-10-30' },
    { ...data, itens: [] },
    ...[0, -1, 1.1, 4, 1e12].map((quantidade) => ({
      ...data,
      itens: [{ itemId: data.itens[0].itemId, quantidade }],
    })),
    { ...data, itens: [{ ...data.itens[0], quantidadePerda: 2 }] },
    { ...data, itens: [{ ...data.itens[0], itemId: s.ids.other.itens[0].id }] },
    { ...data, itens: [data.itens[0], data.itens[0]] },
  ])
    assert.equal(
      s.call('revisar-devolucao-venda', { motivo: 'Teste', dados }).ok,
      false,
      JSON.stringify(dados),
    );
  const command = s.command(data);
  for (const extra of [{ operacaoId: 'bad' }, { revisao: 'bad' }, { motivo: '' }, { extra: true }])
    assert.equal(s.call('devolver-venda', { ...command, ...extra }).ok, false);
  assert.equal(snapshot(s.db), before);
});

test('4E2C: receipts, new returns, stock and document version invalidate review inside write transaction', async (t) => {
  for (const kind of ['receipt', 'return', 'stock', 'version']) {
    const s = await setup(t),
      command = s.command(s.data());
    if (kind === 'receipt')
      createFinancialService(s.db, 'test', clock).registrarRecebimento(
        cadastro({
          vendaId: s.ids.main.id,
          dataEfetiva: '2026-11-01',
          pagamentos: [{ formaPagamentoId: s.ids.pix, valorCentavos: 1000 }],
        }),
      );
    if (kind === 'return')
      createCorrectionService(s.db, 'test', clock).devolverVenda(cadastro(s.data()));
    if (kind === 'stock')
      s.service.registrarEntrada({
        ...cadastro({ produtoId: s.ids.productId, quantidade: 1, custoTotalCentavos: 100 }),
        dataEfetiva: '2026-11-01',
      });
    if (kind === 'version') {
      const triggers = s.db
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='documentos'",
        )
        .all();
      for (const tr of triggers) s.db.exec(`DROP TRIGGER "${tr.name}"`);
      s.db.prepare('UPDATE documentos SET versao=versao+1 WHERE id=?').run(s.ids.main.id);
      for (const tr of triggers) s.db.exec(tr.sql);
    }
    const afterOther = snapshot(s.db);
    assert.equal(s.call('devolver-venda', command).error.code, 'VERSION_CONFLICT', kind);
    assert.equal(snapshot(s.db), afterOther);
  }
});

test('4E2C: lost reply, replay after later effects and database reopening; different content conflicts', async (t) => {
  const s = await setup(t),
    command = s.command(s.data()),
    result = s.ok('devolver-venda', command);
  s.ok('devolver-venda', s.command(s.data()));
  const before = snapshot(s.db);
  assert.deepEqual(s.ok('devolver-venda', command), result);
  assert.equal(snapshot(s.db), before);
  assert.equal(
    s.call('devolver-venda', { ...command, motivo: 'Outro conteúdo' }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  s.db.close();
  const db = await openDatabase(s.directory, 'test');
  try {
    const h = criarHandlersConsultasFinanceiras(db, clock, 'test');
    assert.deepEqual(h.get('correcoes:devolver-venda')(command).data, result);
    assert.equal(snapshot(db), before);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('4E2C: stock, abatements, refund origins and audit failures roll back the complete correction', async (t) => {
  const s = await setup(t);
  for (const table of [
    'documentos',
    'itens_documento',
    'movimentacoes_estoque',
    'abatimentos_parcela',
    'reembolsos_cliente',
    'origens_reembolso',
    'eventos_auditoria',
  ]) {
    const command = s.command(s.data(s.ids.entry, 2, 1));
    s.db.exec(
      `CREATE TRIGGER fail_correction BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected correction failure'); END`,
    );
    const before = snapshot(s.db);
    assert.equal(s.call('devolver-venda', command).ok, false, table);
    assert.equal(snapshot(s.db), before, table);
    s.db.exec('DROP TRIGGER fail_correction');
  }
  s.ok('devolver-venda', s.command(s.data(s.ids.entry, 2, 1)));
});

test('4E2C: independent writers reject stale reviews and replay the same UUID without duplicate effects', async (t) => {
  const s = await setup(t),
    { Worker } = require('node:worker_threads'),
    { resolve } = require('node:path');
  const race = async (commands) => {
    const gate = new SharedArrayBuffer(4),
      workers = commands.map(
        (command) =>
          new Worker(resolve('tests/helpers/correcoes-worker.cjs'), {
            workerData: { directory: s.directory, gate, command },
          }),
      );
    try {
      await Promise.all(
        workers.map(
          (w) =>
            new Promise((resolve, reject) => {
              w.once('message', resolve);
              w.once('error', reject);
            }),
        ),
      );
      const pending = workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.once('message', resolve);
            w.once('error', reject);
          }),
      );
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      return await Promise.all(pending);
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  };
  const commands = [s.command(s.data()), s.command(s.data())],
    results = await race(commands);
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VERSION_CONFLICT').length, 1);
  const winner = commands[results.findIndex((r) => r.result)],
    before = snapshot(s.db),
    replays = await race([winner, winner]);
  assert.deepEqual(replays[0].result, replays[1].result);
  assert.equal(snapshot(s.db), before);
});

test('4E2C: multiple items, cumulative historical cents and legacy persisted hashes remain compatible', async (t) => {
  const f = await fixture(t),
    { createCommercialService } = require('../dist/electron/services/comercial'),
    { createSaleCorrectionService } = require('../dist/electron/services/correcoes-vendas');
  const second = f.catalog.saveProduct(
    cadastro({ ...f.productData, sku: 'SEGUNDO', nome: 'Segundo perfume' }),
  );
  for (const [produtoId, quantidade, custoTotalCentavos] of [
    [f.product.id, 3, 100],
    [second.id, 2, 198],
  ])
    f.service.registrarEntrada(f.command({ produtoId, quantidade, custoTotalCentavos }));
  const client = f.catalog.savePerson('CLIENTE', cadastro({ nome: 'Cliente múltiplos itens' })),
    commercial = createCommercialService(f.db, 'test', clock);
  const draft = commercial.salvarRascunho(
    cadastro({
      tipo: 'VENDA',
      clienteId: client.id,
      modalidadeVenda: 'A_PRAZO',
      dataComercial: '2026-10-31',
      itens: [
        {
          produtoId: f.product.id,
          quantidade: 3,
          valorUnitarioCentavos: 100,
          desconto: { tipo: 'CENTAVOS', valor: 200 },
        },
        { produtoId: second.id, quantidade: 2, valorUnitarioCentavos: 200 },
      ],
    }),
  );
  const sale = commercial.confirmar(
      cadastro({
        id: draft.id,
        versaoEsperada: draft.versao,
        pagamentos: [],
        parcelas: [{ vencimento: '2099-01-01', valorCentavos: 500 }],
      }),
    ),
    service = createSaleCorrectionService(f.db, 'test', clock);
  const legacy = createCorrectionService(f.db, 'test', clock);
  for (const [n, expected] of [
    [0, 33],
    [1, 34],
    [2, 33],
  ]) {
    const dados = {
      documentoId: sale.id,
      dataEfetiva: '2026-11-01',
      itens: [
        { itemId: sale.itens[0].id, quantidade: 1, quantidadePerda: n === 1 ? 1 : 0 },
        ...(n === 2 ? [{ itemId: sale.itens[1].id, quantidade: 2 }] : []),
      ],
    };
    const r = service.revisarDevolucaoVenda({ motivo: 'Correção legado', dados });
    assert.equal(r.itens[0].valorCentavos, expected);
    assert.equal(r.itens[0].custoCentavos, expected);
    const command = { operacaoId: randomUUID(), motivo: r.motivo, dados };
    const result = legacy.devolverVenda(command);
    const before = snapshot(f.db);
    assert.deepEqual(service.devolverVenda({ ...command, revisao: r.revisao }), result);
    assert.equal(snapshot(f.db), before);
  }
  assert.equal(
    createFinancialService(f.db, 'test', clock).consultarVenda(sale.id).saldoReceberCentavos,
    0,
  );
});
