const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/estoque-fixture.cjs'),
  { seedReembolsos, command } = require('./helpers/reembolsos-ui-fixture.cjs'),
  { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { criarHandlersConsultasFinanceiras } = require('../dist/electron/ipc/financeiro'),
  { createFinancialService } = require('../dist/electron/services/financeiro'),
  { createCorrectionService } = require('../dist/electron/services/correcoes'),
  { createFinancialQueryService } = require('../dist/electron/services/financeiro-consulta'),
  { openDatabase } = require('../dist/electron/infrastructure/database');
const clock = () => new Date('2026-11-05T15:00:00Z');
async function setup(t) {
  const f = await fixture(t),
    ids = seedReembolsos(f.db),
    handlers = criarHandlersConsultasFinanceiras(f.db, clock, 'test');
  const call = (method, input) => handlers.get(method)(input);
  const ok = (method, input) => {
    const r = call(method, input);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const pay = (c = ids.main, amount = 10000) => ({
    vendaId: c.saleId,
    reembolsoId: c.reembolsoId,
    dataEfetiva: '2026-11-01',
    pagamentos: [{ formaPagamentoId: ids.pix, valorCentavos: amount }],
  });
  const rev = (c, id) => ({ vendaId: c.saleId, movimentoId: id, dataEfetiva: '2026-11-01' });
  const undo = (c) => ({ vendaId: c.saleId, documentoId: c.correcaoId, dataEfetiva: '2026-11-01' });
  const intention = (method, dados) => ({
    operacaoId: randomUUID(),
    motivo: 'Operação de teste',
    dados,
    revisao: ok(method, { motivo: 'Operação de teste', dados }).revisao,
  });
  return { ...f, ids, handlers, call, ok, pay, rev, undo, intention };
}
const rp = 'financeiro:revisar-pagamento-reembolso',
  pay = 'financeiro:pagar-reembolso',
  rr = 'financeiro:revisar-estorno-reembolso',
  er = 'financeiro:estornar-reembolso',
  rc = 'financeiro:revisar-estorno-recebimento',
  ec = 'financeiro:estornar-recebimento',
  rd = 'correcoes:revisar-estorno-devolucao-venda',
  ed = 'correcoes:estornar-devolucao-venda';
const query = (s) => createFinancialQueryService(s.db, clock);
test('4E2D: required 300/250/200/150 example; partial, full, multi-form and individual reversal; official projections equal commits', async (t) => {
  const s = await setup(t),
    q = query(s);
  let before = q.obterReembolso({
    vendaId: s.ids.main.saleId,
    reembolsoId: s.ids.main.reembolsoId,
  });
  assert.equal(before.saldoExigivelCentavos, 15000);
  const c = s.intention(rp, s.pay()),
    r = s.ok(rp, { motivo: c.motivo, dados: c.dados });
  s.ok(pay, c);
  assert.deepEqual(q.obterVenda(s.ids.main.saleId).resumo.valorComercialLiquidoCentavos, 10000);
  let after = q.obterReembolso({ vendaId: s.ids.main.saleId, reembolsoId: s.ids.main.reembolsoId });
  assert.equal(after.pagoLiquidoCentavos, 10000);
  assert.equal(after.saldoExigivelCentavos, 5000);
  assert.equal(r.obrigacoes[0].saldoPrevistoCentavos, 5000);
  const payment = q.listarMovimentos({
    vendaId: s.ids.main.saleId,
    reembolsoId: s.ids.main.reembolsoId,
  }).itens[0];
  const e = s.intention(rr, s.rev(s.ids.main, payment.id));
  const preview = s.ok(rr, { motivo: e.motivo, dados: e.dados });
  const result = s.ok(er, e);
  assert.deepEqual(result.financeiro, preview.previsto);
  after = q.obterReembolso({ vendaId: s.ids.main.saleId, reembolsoId: s.ids.main.reembolsoId });
  assert.equal(after.pagoLiquidoCentavos, 0);
  assert.equal(after.saldoExigivelCentavos, 15000);
  assert.equal(
    q.obterMovimento({ vendaId: s.ids.main.saleId, movimentoId: payment.id }).estornadoPorId,
    result.movimentoId,
  );
  const dados = {
    ...s.pay(),
    pagamentos: [
      { formaPagamentoId: s.ids.pix, valorCentavos: 9000 },
      { formaPagamentoId: s.ids.cash, valorCentavos: 6000 },
    ],
  };
  const full = s.ok(pay, s.intention(rp, dados));
  assert.equal(full.movimentos.length, 2);
  assert.equal(
    q.obterReembolso({ vendaId: s.ids.main.saleId, reembolsoId: s.ids.main.reembolsoId })
      .saldoExigivelCentavos,
    0,
  );
  s.ok(er, s.intention(rr, s.rev(s.ids.main, full.movimentos[0])));
  assert.equal(
    q.obterReembolso({ vendaId: s.ids.main.saleId, reembolsoId: s.ids.main.reembolsoId })
      .saldoExigivelCentavos,
    9000,
  );
  assert.equal(
    q.obterMovimento({ vendaId: s.ids.main.saleId, movimentoId: full.movimentos[1] })
      .estornadoPorId,
    null,
  );
});
test('4E2D: query_only reviews for all operations do not change a single table', async (t) => {
  const s = await setup(t),
    payment = s.ok(pay, s.intention(rp, s.pay())),
    before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  for (const [m, dados] of [
    [rp, s.pay(s.ids.other, 5000)],
    [rr, s.rev(s.ids.main, payment.movimentos[0])],
    [rc, s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0])],
    [rd, s.undo(s.ids.apt)],
  ])
    assert.match(s.ok(m, { motivo: 'Somente leitura', dados }).revisao, /^[a-f0-9]{64}$/);
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
});
test('4E2D: receipt reversal is integral and individual; historical inactive form remains valid; dependent receipts and reversals blocked', async (t) => {
  const s = await setup(t),
    c = s.intention(rc, s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0]));
  s.catalog.saveReference(
    'FORMA_PAGAMENTO',
    command({ id: s.ids.pix, nome: 'Pix inativo', ativo: false }),
  );
  // Form deactivation is not a dependency of a reversal: original historical form is used.
  const r = s.ok(ec, c);
  assert.equal(r.financeiro.saldoReceberCentavos, 16000);
  const q = query(s);
  assert.equal(
    q.obterMovimento({ vendaId: s.ids.receipt.saleId, movimentoId: s.ids.receipt.recebimentos[1] })
      .estornadoPorId,
    null,
  );
  for (const id of [s.ids.receipt.recebimentos[0], r.movimentoId])
    assert.equal(
      s.call(rc, { motivo: 'Teste', dados: s.rev(s.ids.receipt, id) }).error.code,
      'INVALID_STATE',
    );
  const blocked = q.obterMovimento({
    vendaId: s.ids.main.saleId,
    movimentoId: s.ids.main.recebimentos[0],
  });
  assert.equal(blocked.elegibilidadeEstorno.permitido, false);
  assert.ok(blocked.elegibilidadeEstorno.dependencias.some((d) => d.id === s.ids.main.correcaoId));
  assert.equal(
    s.call(rc, { motivo: 'Teste', dados: s.rev(s.ids.main, s.ids.main.recebimentos[0]) }).ok,
    false,
  );
});
test('4E2D: reverse payment dependency first; returns with apt, mixed and unsuitable goods restore exact historical stock and financial effects', async (t) => {
  const s = await setup(t),
    q = query(s);
  const p = s.ok(pay, s.intention(rp, s.pay()));
  let doc = q.obterDocumento({ vendaId: s.ids.main.saleId, documentoId: s.ids.main.correcaoId });
  assert.equal(doc.elegibilidadeEstorno.permitido, false);
  assert.ok(doc.elegibilidadeEstorno.dependencias.some((d) => d.id === p.movimentos[0]));
  assert.equal(s.call(rd, { motivo: 'Teste', dados: s.undo(s.ids.main) }).ok, false);
  s.ok(er, s.intention(rr, s.rev(s.ids.main, p.movimentos[0])));
  for (const c of [s.ids.main, s.ids.apt, s.ids.improper]) {
    const preview = s.ok(rd, { motivo: 'Desfazer devolução', dados: s.undo(c) }),
      before = s.service.consultarSaldo(c.productId),
      res = s.ok(ed, {
        operacaoId: randomUUID(),
        motivo: preview.motivo,
        dados: preview.dados,
        revisao: preview.revisao,
      }),
      after = s.service.consultarSaldo(c.productId);
    assert.deepEqual(
      createFinancialService(s.db, 'test', clock).consultarVenda(c.saleId),
      preview.previsto,
    );
    assert.equal(
      after.quantidade,
      before.quantidade + preview.estoque.reduce((n, m) => n + m.quantidadeDelta, 0),
    );
    assert.equal(
      after.valorTotalCentavos,
      before.valorTotalCentavos + preview.estoque.reduce((n, m) => n + m.valorDeltaCentavos, 0),
    );
    assert.equal(
      q.obterDocumento({ vendaId: c.saleId, documentoId: c.correcaoId }).estado,
      'ESTORNADO',
    );
    assert.equal(
      q.obterDocumento({ vendaId: c.saleId, documentoId: res.documentoId }).categoria,
      'ESTORNO_DEVOLUCAO',
    );
  }
  assert.equal(
    q.obterDocumento({ vendaId: s.ids.blocked.saleId, documentoId: s.ids.blocked.correcaoId })
      .elegibilidadeEstorno.permitido,
    false,
  );
  assert.equal(s.call(rd, { motivo: 'Teste', dados: s.undo(s.ids.blocked) }).ok, false);
});
test('4E2D: validation, quitada/anulada, inactive form, crossed sale, dates, fields and arity cause no writes', async (t) => {
  const s = await setup(t),
    before = snapshot(s.db);
  for (const method of [rp, pay, rr, er, rc, ec, rd, ed])
    for (const args of [[], [null], [{}, {}], [{ sql: 'SELECT 1' }]])
      assert.equal(s.handlers.get(method)(...args).ok, false);
  for (const dados of [
    s.pay(s.ids.main, 0),
    s.pay(s.ids.main, -1),
    s.pay(s.ids.main, 1.1),
    s.pay(s.ids.main, 15001),
    s.pay(s.ids.annulled, 1),
    { ...s.pay(), dataEfetiva: '2099-01-01' },
    { ...s.pay(), dataEfetiva: '2026-02-30' },
    { ...s.pay(), dataEfetiva: '2026-10-30' },
    { ...s.pay(), vendaId: s.ids.other.saleId },
    { ...s.pay(), extra: true },
  ])
    assert.equal(s.call(rp, { motivo: 'Teste', dados }).ok, false, JSON.stringify(dados));
  assert.equal(snapshot(s.db), before);
  s.ok(pay, s.intention(rp, s.pay(s.ids.main, 15000)));
  assert.equal(s.call(rp, { motivo: 'Teste', dados: s.pay() }).ok, false);
  s.catalog.saveReference(
    'FORMA_PAGAMENTO',
    command({ id: s.ids.pix, nome: 'Pix inativo', ativo: false }),
  );
  assert.equal(
    s.call(rp, { motivo: 'Teste', dados: s.pay(s.ids.other, 1) }).error.code,
    'INACTIVE_REFERENCE',
  );
  const c = s.intention(rc, s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0]));
  for (const extra of [{ operacaoId: 'bad' }, { revisao: 'bad' }, { motivo: '' }, { extra: 1 }])
    assert.equal(s.call(ec, { ...c, ...extra }).ok, false);
});
test('4E2D: sale links are strict and full cancellation cannot be reversed through the return boundary', async (t) => {
  const s = await setup(t);
  for (const [method, dados] of [
    [rc, { ...s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0]), vendaId: s.ids.main.saleId }],
    [rd, { ...s.undo(s.ids.main), vendaId: s.ids.other.saleId }],
  ])
    assert.equal(s.call(method, { motivo: 'Teste', dados }).error.code, 'NOT_FOUND');
  const result = createCorrectionService(s.db, 'test', clock).cancelarVenda(
    command({ documentoId: s.ids.receipt.saleId, dataEfetiva: '2026-11-01' }),
  );
  const c = query(s).obterDocumento({
    vendaId: s.ids.receipt.saleId,
    documentoId: result.documentoId,
  });
  assert.equal(c.categoria, 'CANCELAMENTO_VENDA');
  assert.equal(c.elegibilidadeEstorno.permitido, false);
  assert.equal(
    s.call(rd, {
      motivo: 'Teste',
      dados: {
        vendaId: s.ids.receipt.saleId,
        documentoId: result.documentoId,
        dataEfetiva: '2026-11-01',
      },
    }).error.code,
    'INVALID_STATE',
  );
  const rid = s.db
    .prepare('SELECT id FROM reembolsos_cliente WHERE documento_correcao_id=?')
    .get(result.documentoId).id;
  const paid = s.ok(
    pay,
    s.intention(rp, s.pay({ saleId: s.ids.receipt.saleId, reembolsoId: rid }, 1000)),
  );
  assert.equal(paid.financeiro.reembolsosPagosCentavos, 1000);
});

test('4E2D: financial, correction, form and stock changes invalidate a new intention; replay bypasses changed balances', async (t) => {
  const s = await setup(t);
  const c = s.intention(rp, s.pay());
  createFinancialService(s.db, 'test', clock).pagarReembolso(
    command({
      reembolsoId: s.ids.main.reembolsoId,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: s.ids.cash, valorCentavos: 1000 }],
    }),
  );
  const before = snapshot(s.db);
  assert.equal(s.call(pay, c).error.code, 'VERSION_CONFLICT');
  assert.equal(snapshot(s.db), before);
  const fresh = s.intention(rp, s.pay(s.ids.main, 5000)),
    r = s.ok(pay, fresh);
  s.ok(pay, s.intention(rp, s.pay(s.ids.main, 1000)));
  assert.deepEqual(s.ok(pay, fresh), r);
  assert.equal(
    s.call(pay, { ...fresh, motivo: 'Outro conteúdo' }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  const u = s.intention(rd, s.undo(s.ids.apt));
  s.service.registrarEntrada({
    ...command({ produtoId: s.ids.apt.productId, quantidade: 1, custoTotalCentavos: 500 }),
    dataEfetiva: '2026-11-01',
  });
  assert.equal(s.call(ed, u).error.code, 'VERSION_CONFLICT');
  const form = s.intention(rp, s.pay(s.ids.other, 100));
  s.catalog.saveReference(
    'FORMA_PAGAMENTO',
    command({ id: s.ids.pix, nome: 'Pix inativo', ativo: false }),
  );
  assert.equal(s.call(pay, form).error.code, 'VERSION_CONFLICT');
});
test('4E2D: complete rollback at cash, allocations, document, stock, abatements and audit; legacy replay and reopen preserve hashes', async (t) => {
  const s = await setup(t);
  for (const [review, write, dados, tables] of [
    [rp, pay, s.pay(), ['movimentos_financeiros', 'alocacoes_reembolso', 'eventos_auditoria']],
    [
      rc,
      ec,
      s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0]),
      ['movimentos_financeiros', 'alocacoes_recebimento', 'eventos_auditoria'],
    ],
    [
      rd,
      ed,
      s.undo(s.ids.apt),
      [
        'documentos',
        'itens_documento',
        'movimentacoes_estoque',
        'abatimentos_parcela',
        'eventos_auditoria',
      ],
    ],
  ]) {
    for (const table of tables) {
      const c = s.intention(review, dados);
      s.db.exec(
        `CREATE TRIGGER fail_4e2d BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'test-only rollback'); END`,
      );
      const before = snapshot(s.db);
      assert.equal(s.call(write, c).ok, false, table);
      assert.equal(snapshot(s.db), before, table);
      s.db.exec('DROP TRIGGER fail_4e2d');
    }
  }
  const c = s.intention(rp, s.pay());
  const legacy = {
    operacaoId: c.operacaoId,
    motivo: c.motivo,
    dados: {
      reembolsoId: c.dados.reembolsoId,
      dataEfetiva: c.dados.dataEfetiva,
      pagamentos: c.dados.pagamentos,
    },
  };
  const result = createFinancialService(s.db, 'test', clock).pagarReembolso(legacy);
  assert.deepEqual(s.ok(pay, c), result);
  const before = snapshot(s.db);
  s.db.close();
  const db = await openDatabase(s.directory, 'test');
  try {
    assert.deepEqual(criarHandlersConsultasFinanceiras(db, clock).get(pay)(c).data, result);
    assert.equal(snapshot(db), before);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('4E2D: independent payment writers serialize review conflicts and duplicate UUID replay', async (t) => {
  const s = await setup(t),
    { Worker } = require('node:worker_threads'),
    { resolve } = require('node:path');
  const race = async (commands) => {
    const gate = new SharedArrayBuffer(4),
      workers = commands.map(
        (command) =>
          new Worker(resolve('tests/helpers/reembolsos-worker.cjs'), {
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
  };
  const commands = [
      s.intention(rp, s.pay(s.ids.main, 15000)),
      s.intention(rp, s.pay(s.ids.main, 15000)),
    ],
    results = await race(commands);
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VERSION_CONFLICT').length, 1);
  const c = commands[results.findIndex((r) => r.result)],
    before = snapshot(s.db),
    replays = await race([c, c]);
  assert.deepEqual(replays[0].result, replays[1].result);
  assert.equal(snapshot(s.db), before);
});
test('4E2D: all legacy reversal hashes/results replay through public boundary after subsequent state changes', async (t) => {
  const s = await setup(t),
    fin = createFinancialService(s.db, 'test', clock),
    cor = createCorrectionService(s.db, 'test', clock);
  const payment = s.ok(pay, s.intention(rp, s.pay()));
  for (const [review, write, dados, legacyMethod] of [
    [rr, er, s.rev(s.ids.main, payment.movimentos[0]), 'estornarReembolso'],
    [rc, ec, s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0]), 'estornarRecebimento'],
    [rd, ed, s.undo(s.ids.apt), 'estornarDevolucao'],
  ]) {
    const c = s.intention(review, dados),
      { vendaId, ...legacyDados } = c.dados;
    assert.ok(vendaId);
    const result = (legacyMethod === 'estornarDevolucao' ? cor : fin)[legacyMethod]({
      operacaoId: c.operacaoId,
      motivo: c.motivo,
      dados: legacyDados,
    });
    s.service.registrarEntrada({
      ...command({ produtoId: s.ids.other.productId, quantidade: 1, custoTotalCentavos: 1 }),
      dataEfetiva: '2026-11-01',
    });
    const before = snapshot(s.db);
    assert.deepEqual(s.ok(write, c), result);
    assert.equal(snapshot(s.db), before);
    assert.equal(
      s.call(write, { ...c, motivo: 'Conteúdo incompatível' }).error.code,
      'IDEMPOTENCY_CONFLICT',
    );
  }
});
test('4E2D: reversal of refund allocations/audit rolls back; later receipts and refund dependencies reject stale reviews', async (t) => {
  const s = await setup(t),
    payment = s.ok(pay, s.intention(rp, s.pay())),
    c = s.intention(rr, s.rev(s.ids.main, payment.movimentos[0]));
  for (const table of ['movimentos_financeiros', 'alocacoes_reembolso', 'eventos_auditoria']) {
    s.db.exec(
      `CREATE TRIGGER fail_4e2d BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'test-only rollback'); END`,
    );
    const before = snapshot(s.db);
    assert.equal(s.call(er, c).ok, false);
    assert.equal(snapshot(s.db), before);
    s.db.exec('DROP TRIGGER fail_4e2d');
  }
  s.ok(er, c);
  const receipt = s.intention(rc, s.rev(s.ids.receipt, s.ids.receipt.recebimentos[0]));
  createFinancialService(s.db, 'test', clock).registrarRecebimento(
    command({
      vendaId: s.ids.receipt.saleId,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: s.ids.pix, valorCentavos: 1000 }],
    }),
  );
  assert.equal(s.call(ec, receipt).error.code, 'VERSION_CONFLICT');
  const undo = s.intention(rd, s.undo(s.ids.other));
  s.ok(pay, s.intention(rp, s.pay(s.ids.other, 1000)));
  assert.equal(s.call(ed, undo).error.code, 'VERSION_CONFLICT');
});
