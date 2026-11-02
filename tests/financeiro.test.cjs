const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { resolve, join } = require('node:path');
const Database = require('better-sqlite3');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { createCommercialService } = require('../dist/electron/services/comercial');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { reconciliarComercial } = require('../dist/electron/services/comercial-reconciliation');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const cmd = (dados) => ({ operacaoId: randomUUID(), motivo: 'Financeiro 3D', dados });
async function setup(t, entrada = 0) {
  const f = await fixture(t);
  const client = f.catalog.savePerson('CLIENTE', cadastro({ nome: 'Cliente' }));
  const form = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Pix' }));
  const form2 = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Dinheiro' }));
  f.service.registrarEntrada({
    ...f.command({ produtoId: f.product.id, quantidade: 10, custoTotalCentavos: 1000 }),
  });
  const clock = () => new Date('2026-11-01T15:00:00Z');
  const commercial = createCommercialService(f.db, '3D', clock),
    financial = createFinancialService(f.db, '3D', clock);
  const draft = commercial.salvarRascunho(
    cmd({
      tipo: 'VENDA',
      clienteId: client.id,
      modalidadeVenda: 'A_PRAZO',
      dataComercial: '2026-10-31',
      itens: [{ produtoId: f.product.id, quantidade: 3, valorUnitarioCentavos: 10000 }],
    }),
  );
  const data = {
    id: draft.id,
    versaoEsperada: draft.versao,
    pagamentos: entrada ? [{ formaPagamentoId: form.id, valorCentavos: entrada }] : [],
    parcelas: [
      { valorCentavos: 10000, vencimento: '2026-11-10' },
      { valorCentavos: 20000 - entrada, vencimento: '2026-12-10' },
    ],
  };
  const sale = entrada
    ? commercial.confirmarComEntrada(cmd(data))
    : commercial.confirmar(cmd(data));
  const corrections = createCorrectionService(f.db, '3D', clock);
  return { ...f, client, form, form2, commercial, financial, corrections, sale };
}
test('3D entry, later partial receipts, anticipation and idempotency count actual money once', async (t) => {
  const f = await setup(t, 5000);
  assert.equal(f.sale.saldoReceberCentavos, 25000);
  const receive = cmd({
    vendaId: f.sale.id,
    dataEfetiva: '2026-11-01',
    pagamentos: [
      { formaPagamentoId: f.form.id, valorCentavos: 6000 },
      { formaPagamentoId: f.form2.id, valorCentavos: 2000 },
    ],
  });
  const r = f.financial.registrarRecebimento(receive);
  assert.equal(r.financeiro.recebimentosEfetivosCentavos, 13000);
  assert.equal(r.financeiro.saldoReceberCentavos, 17000);
  assert.deepEqual(f.financial.registrarRecebimento(receive), r);
  let ps = f.financial.listarParcelas(f.sale.id);
  assert.deepEqual(
    ps.map((p) => p.status),
    ['QUITADO', 'PARCIALMENTE_PAGO', 'PENDENTE'],
  );
  f.financial.registrarRecebimento(
    cmd({
      vendaId: f.sale.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 17000 }],
    }),
  );
  assert.equal(f.financial.consultarVenda(f.sale.id).saldoReceberCentavos, 0);
  ps = f.financial.listarParcelas(f.sale.id);
  assert.ok(ps.every((p) => p.status === 'QUITADO'));
  assert.throws(
    () =>
      f.financial.registrarRecebimento(
        cmd({
          vendaId: f.sale.id,
          dataEfetiva: '2026-11-01',
          pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 1 }],
        }),
      ),
    (e) => e.code === 'VALIDATION',
  );
});
test('3D receipt reversal restores debt and preserves original allocations', async (t) => {
  const f = await setup(t);
  const r = f.financial.registrarRecebimento(
    cmd({
      vendaId: f.sale.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 12000 }],
    }),
  );
  f.financial.estornarRecebimento(cmd({ movimentoId: r.movimentos[0], dataEfetiva: '2026-11-01' }));
  const s = f.financial.consultarVenda(f.sale.id);
  assert.equal(s.recebimentosEfetivosCentavos, 12000);
  assert.equal(s.estornosRecebimentoCentavos, 12000);
  assert.equal(s.saldoReceberCentavos, 30000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM alocacoes_recebimento').get().n, 4);
});
module.exports = { setup, cmd };

test('3D integrated entry, installments, partial receipts, return, abatements and partial refunds never double count', async (t) => {
  const f = await setup(t, 10000);
  const received = f.financial.registrarRecebimento(
    cmd({
      vendaId: f.sale.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 15000 }],
    }),
  );
  const correction = cmd({
    documentoId: f.sale.id,
    dataEfetiva: '2026-11-01',
    itens: [{ itemId: f.sale.itens[0].id, quantidade: 2 }],
  });
  const result = f.corrections.devolverVenda(correction);
  assert.deepEqual(f.corrections.devolverVenda(correction), result);
  let s = f.financial.consultarVenda(f.sale.id);
  assert.equal(s.valorOriginalCentavos, 30000);
  assert.equal(s.recebimentosEfetivosCentavos, 25000);
  assert.equal(s.abatimentosDividaCentavos, 20000);
  assert.equal(s.valorComercialLiquidoCentavos, 10000);
  assert.equal(s.saldoReceberCentavos, 0);
  assert.equal(s.reembolsosPendentesCentavos, 15000);
  assert.throws(
    () =>
      f.financial.estornarRecebimento(
        cmd({ movimentoId: received.movimentos[0], dataEfetiva: '2026-11-01' }),
      ),
    (e) => e.code === 'INVALID_STATE',
  );
  const obligation = f.financial.listarReembolsos(f.sale.id)[0];
  const payment = f.financial.pagarReembolso(
    cmd({
      reembolsoId: obligation.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 10000 }],
    }),
  );
  s = f.financial.consultarVenda(f.sale.id);
  assert.equal(s.reembolsosPagosCentavos, 10000);
  assert.equal(s.reembolsosPendentesCentavos, 5000);
  assert.equal(s.saldoReceberCentavos, 0);
  assert.throws(
    () =>
      f.corrections.estornarDevolucao(
        cmd({ documentoId: result.documentoId, dataEfetiva: '2026-11-01' }),
      ),
    (e) => e.code === 'INVALID_STATE',
  );
  f.financial.estornarReembolso(
    cmd({ movimentoId: payment.movimentos[0], dataEfetiva: '2026-11-01' }),
  );
  assert.equal(f.financial.consultarVenda(f.sale.id).reembolsosPendentesCentavos, 15000);
  f.financial.pagarReembolso(
    cmd({
      reembolsoId: obligation.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [
        { formaPagamentoId: f.form.id, valorCentavos: 7000 },
        { formaPagamentoId: f.form2.id, valorCentavos: 8000 },
      ],
    }),
  );
  assert.equal(f.financial.consultarVenda(f.sale.id).reembolsosPendentesCentavos, 0);
  assert.ok(reconciliarComercial(f.db));
  f.db.close();
  const reopened = await openDatabase(f.directory, '3D');
  reopened.close();
});
test('3D unsuitable return removes exact historical cost while current average and existing inventory remain unchanged', async (t) => {
  const f = await setup(t);
  f.service.registrarEntrada(
    f.command({ produtoId: f.product.id, quantidade: 4, custoTotalCentavos: 4000 }),
  );
  const before = f.service.consultarSaldo(f.product.id);
  const result = f.corrections.devolverVenda(
    cmd({
      documentoId: f.sale.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: f.sale.itens[0].id, quantidade: 1, quantidadePerda: 1 }],
    }),
  );
  const after = f.service.consultarSaldo(f.product.id);
  assert.equal(after.quantidade, before.quantidade);
  assert.equal(after.valorTotalCentavos, before.valorTotalCentavos);
  const ms = f.db
    .prepare(
      'SELECT m.* FROM movimentacoes_estoque m JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id JOIN itens_documento i ON i.id=v.item_documento_id WHERE i.documento_id=? ORDER BY m.id',
    )
    .all(result.documentoId);
  assert.equal(ms.length, 2);
  assert.equal(ms[0].valor_delta_centavos, 100);
  assert.equal(ms[1].valor_delta_centavos, -100);
  assert.equal(ms[1].movimentacao_origem_id, ms[0].id);
  f.corrections.estornarDevolucao(
    cmd({ documentoId: result.documentoId, dataEfetiva: '2026-11-01' }),
  );
  const restored = f.service.consultarSaldo(f.product.id);
  assert.equal(restored.quantidade, before.quantidade);
  assert.equal(restored.valorTotalCentavos, before.valorTotalCentavos);
  assert.equal(f.financial.consultarVenda(f.sale.id).saldoReceberCentavos, 30000);
});
test('3D sale cancellation preserves receipts, creates refund and blocks repeated cancellation', async (t) => {
  const f = await setup(t, 5000);
  f.corrections.cancelarVenda(cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' }));
  const s = f.financial.consultarVenda(f.sale.id);
  assert.equal(s.recebimentosEfetivosCentavos, 5000);
  assert.equal(s.saldoReceberCentavos, 0);
  assert.equal(s.reembolsosPendentesCentavos, 5000);
  assert.equal(f.service.consultarSaldo(f.product.id).quantidade, 10);
  assert.throws(
    () => f.corrections.cancelarVenda(cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' })),
    (e) => e.code === 'INVALID_STATE',
  );
  assert.ok(reconciliarComercial(f.db));
});
test('3D return failure at loss, obligation, audit or finalization rolls back every effect', async (t) => {
  const f = await setup(t, 5000);
  const tables = [
    'documentos',
    'itens_documento',
    'movimentacoes_estoque',
    'saldos_estoque',
    'vinculos_estoque_comercial',
    'abatimentos_parcela',
    'reembolsos_cliente',
    'origens_reembolso',
    'operacoes',
    'eventos_auditoria',
  ];
  const snapshot = () =>
    Object.fromEntries(
      tables.map((name) => [name, f.db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]),
    );
  for (const target of [
    'movimentacoes_estoque',
    'abatimentos_parcela',
    'reembolsos_cliente',
    'origens_reembolso',
    'eventos_auditoria',
    'operacoes',
  ]) {
    const before = snapshot();
    f.db.exec(
      `CREATE TRIGGER injected_failure BEFORE ${target === 'operacoes' ? 'UPDATE' : 'INSERT'} ON ${target} BEGIN SELECT RAISE(ABORT,'injected'); END;`,
    );
    const c = cmd({
      documentoId: f.sale.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: f.sale.itens[0].id, quantidade: 3, quantidadePerda: 3 }],
    });
    assert.throws(() => f.corrections.devolverVenda(c));
    f.db.exec('DROP TRIGGER injected_failure');
    assert.deepEqual(snapshot(), before, target);
  }
});
test('3D purchase return excludes freight, preserves sold cost and records valuation; purchase cancellation requires last movements', async (t) => {
  const f = await setup(t);
  const supplier = f.catalog.savePerson('FORNECEDOR', cadastro({ nome: 'Fornecedor' }));
  function purchase() {
    const d = f.commercial.salvarRascunho(
      cmd({
        tipo: 'COMPRA',
        fornecedorId: supplier.id,
        dataComercial: '2026-11-01',
        freteCentavos: 100,
        itens: [{ produtoId: f.product.id, quantidade: 2, valorUnitarioCentavos: 500 }],
      }),
    );
    return f.commercial.confirmar(
      cmd({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 1100 }],
      }),
    );
  }
  const p = purchase();
  const r = f.corrections.devolverCompra(
    cmd({
      documentoId: p.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: p.itens[0].id, quantidade: 1 }],
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 500 }],
    }),
  );
  const row = f.db.prepare('SELECT * FROM itens_documento WHERE documento_id=?').get(r.documentoId);
  assert.equal(row.frete_rateado_centavos, 0);
  assert.equal(row.valor_liquido_centavos, 500);
  assert.equal(row.resultado_ajuste_centavos, 500 - row.valor_custo_estoque_centavos);
  assert.equal(f.commercial.consultar(f.sale.id).itens[0].valorCustoEstoqueCentavos, 300);
  assert.throws(
    () => f.corrections.cancelarCompra(cmd({ documentoId: p.id, dataEfetiva: '2026-11-01' })),
    (e) => e.code === 'INVALID_STATE',
  );
  f.corrections.estornarDevolucao(cmd({ documentoId: r.documentoId, dataEfetiva: '2026-11-01' }));
  const last = purchase();
  const before = f.service.consultarSaldo(f.product.id);
  f.corrections.cancelarCompra(cmd({ documentoId: last.id, dataEfetiva: '2026-11-01' }));
  assert.equal(
    f.service.consultarSaldo(f.product.id).valorTotalCentavos,
    before.valorTotalCentavos - 1100,
  );
  assert.ok(reconciliarComercial(f.db));
});

async function race(directory, jobs) {
  const gate = new SharedArrayBuffer(4);
  const workers = jobs.map(
    (job) =>
      new Worker(resolve('tests/helpers/financeiro-worker.cjs'), {
        workerData: { directory, gate, ...job },
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
test('3D concurrent receipts, duplicate retries, returns and refunds serialize independent connections', async (t) => {
  const f = await setup(t);
  const receive = () =>
    cmd({
      vendaId: f.sale.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 30000 }],
    });
  const commands = [receive(), receive()];
  let results = await race(
    f.directory,
    commands.map((command) => ({ method: 'registrarRecebimento', command })),
  );
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VALIDATION').length, 1);
  const winner = commands[results.findIndex((r) => r.result)];
  results = await race(
    f.directory,
    [winner, winner].map((command) => ({ method: 'registrarRecebimento', command })),
  );
  assert.deepEqual(results[0].result, results[1].result);
  const ret = () =>
    cmd({
      documentoId: f.sale.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: f.sale.itens[0].id, quantidade: 2 }],
    });
  results = await race(
    f.directory,
    [ret(), ret()].map((command) => ({ method: 'devolverVenda', correction: true, command })),
  );
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VALIDATION').length, 1);
  const obligation = f.financial.listarReembolsos(f.sale.id)[0];
  const pay = () =>
    cmd({
      reembolsoId: obligation.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 20000 }],
    });
  results = await race(
    f.directory,
    [pay(), pay()].map((command) => ({ method: 'pagarReembolso', command })),
  );
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VALIDATION').length, 1);
  assert.equal(f.financial.consultarVenda(f.sale.id).reembolsosPendentesCentavos, 0);
  assert.ok(reconciliarComercial(f.db));
});
test('3D busy writer is retriable and failed receipt/refund writes leave no operation or allocation', async (t) => {
  const f = await setup(t);
  const c = cmd({
    vendaId: f.sale.id,
    dataEfetiva: '2026-11-01',
    pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 30000 }],
  });
  const lock = new Database(join(f.directory, 'mnr-perfumes.db'));
  f.db.pragma('busy_timeout=10');
  lock.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(
      () => f.financial.registrarRecebimento(c),
      (e) => e.code === 'BUSY',
    );
  } finally {
    lock.exec('ROLLBACK');
    lock.close();
  }
  for (const target of [
    'movimentos_financeiros',
    'alocacoes_recebimento',
    'eventos_auditoria',
    'operacoes',
  ]) {
    f.db.exec(
      `CREATE TRIGGER injected_receipt BEFORE ${target === 'operacoes' ? 'UPDATE' : 'INSERT'} ON ${target} BEGIN SELECT RAISE(ABORT,'injected'); END;`,
    );
    assert.throws(() => f.financial.registrarRecebimento(c));
    f.db.exec('DROP TRIGGER injected_receipt');
    assert.equal(
      f.db.prepare('SELECT count(*) n FROM operacoes WHERE id=?').get(c.operacaoId).n,
      0,
    );
    assert.equal(f.financial.consultarVenda(f.sale.id).recebimentosEfetivosCentavos, 0);
  }
  f.financial.registrarRecebimento(c);
  f.corrections.cancelarVenda(cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' }));
  const r = f.financial.listarReembolsos(f.sale.id)[0];
  const refund = cmd({
    reembolsoId: r.id,
    dataEfetiva: '2026-11-01',
    pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 30000 }],
  });
  for (const target of [
    'movimentos_financeiros',
    'alocacoes_reembolso',
    'eventos_auditoria',
    'operacoes',
  ]) {
    f.db.exec(
      `CREATE TRIGGER injected_refund BEFORE ${target === 'operacoes' ? 'UPDATE' : 'INSERT'} ON ${target} BEGIN SELECT RAISE(ABORT,'injected'); END;`,
    );
    assert.throws(() => f.financial.pagarReembolso(refund));
    f.db.exec('DROP TRIGGER injected_refund');
    assert.equal(f.financial.consultarVenda(f.sale.id).reembolsosPendentesCentavos, 30000);
  }
  f.financial.pagarReembolso(refund);
  assert.equal(f.financial.consultarVenda(f.sale.id).reembolsosPendentesCentavos, 0);
});
test('3D successive returns conserve independent historical cents and mixed physical destinations', async (t) => {
  const f = await setup(t);
  const p = f.catalog.saveProduct(
    cadastro({ ...f.productData, sku: 'RESIDUAL', nome: 'Residual' }),
  );
  f.service.registrarEntrada(
    f.command({ produtoId: p.id, quantidade: 3, custoTotalCentavos: 100 }),
  );
  const d = f.commercial.salvarRascunho(
    cmd({
      tipo: 'VENDA',
      clienteId: f.client.id,
      modalidadeVenda: 'A_PRAZO',
      dataComercial: '2026-10-31',
      descontoGlobal: { tipo: 'CENTAVOS', valor: 1 },
      itens: [
        {
          produtoId: p.id,
          quantidade: 3,
          valorUnitarioCentavos: 100,
          desconto: { tipo: 'CENTAVOS', valor: 1 },
        },
      ],
    }),
  );
  const sale = f.commercial.confirmar(
    cmd({
      id: d.id,
      versaoEsperada: d.versao,
      parcelas: [{ valorCentavos: 298, vencimento: '2026-12-01' }],
    }),
  );
  const returns = [];
  for (const loss of [0, 1, 0])
    returns.push(
      f.corrections.devolverVenda(
        cmd({
          documentoId: sale.id,
          dataEfetiva: '2026-11-01',
          itens: [{ itemId: sale.itens[0].id, quantidade: 1, quantidadePerda: loss }],
        }),
      ).documentoId,
    );
  const items = returns.map((id) =>
    f.db.prepare('SELECT * FROM itens_documento WHERE documento_id=?').get(id),
  );
  assert.deepEqual(
    items.map((i) => i.valor_custo_estoque_centavos),
    [33, 34, 33],
  );
  for (const key of [
    'valor_bruto_centavos',
    'desconto_item_centavos',
    'desconto_global_rateado_centavos',
    'valor_liquido_centavos',
    'valor_custo_estoque_centavos',
  ])
    assert.equal(
      items.reduce((v, i) => v + i[key], 0),
      f.db.prepare('SELECT * FROM itens_documento WHERE id=?').get(sale.itens[0].id)[key],
    );
  const balance = f.service.consultarSaldo(p.id);
  assert.equal(balance.quantidade, 2);
  assert.equal(balance.valorTotalCentavos, 66);
  assert.equal(f.financial.consultarVenda(sale.id).saldoReceberCentavos, 0);
  assert.ok(reconciliarComercial(f.db));
});
test('3D explicit allocations, overdue precedence, invalid cross-sale allocation and excess refund', async (t) => {
  const f = await setup(t);
  const parcels = f.financial.listarParcelas(f.sale.id);
  const receive = cmd({
    vendaId: f.sale.id,
    dataEfetiva: '2026-11-01',
    pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 3000 }],
    alocacoes: [{ parcelaId: parcels[1].id, valorCentavos: 3000 }],
  });
  f.financial.registrarRecebimento(receive);
  assert.deepEqual(
    f.financial.listarParcelas(f.sale.id).map((p) => p.recebimentosCentavos),
    [0, 3000],
  );
  const later = createFinancialService(f.db, 'test', () => new Date('2027-01-01T15:00:00Z'));
  assert.ok(later.listarParcelas(f.sale.id).every((p) => p.status === 'VENCIDO'));
  assert.equal(later.listarParcelas(f.sale.id)[1].recebimentoParcial, true);
  assert.throws(
    () =>
      f.financial.registrarRecebimento({
        ...receive,
        dados: {
          ...receive.dados,
          pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 4000 }],
        },
      }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () =>
      f.financial.registrarRecebimento(
        cmd({ ...receive.dados, alocacoes: [{ parcelaId: 999999, valorCentavos: 3000 }] }),
      ),
    (e) => e.code === 'VALIDATION',
  );
  f.corrections.cancelarVenda(cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' }));
  const obligation = f.financial.listarReembolsos(f.sale.id)[0];
  assert.throws(
    () =>
      f.financial.pagarReembolso(
        cmd({
          reembolsoId: obligation.id,
          dataEfetiva: '2026-11-01',
          pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 3001 }],
        }),
      ),
    (e) => e.code === 'VALIDATION',
  );
});
test('3D receipt versus cancellation race ends with either no cash or a fully supported refund obligation', async (t) => {
  const f = await setup(t);
  const results = await race(f.directory, [
    {
      method: 'registrarRecebimento',
      command: cmd({
        vendaId: f.sale.id,
        dataEfetiva: '2026-11-01',
        pagamentos: [{ formaPagamentoId: f.form.id, valorCentavos: 10000 }],
      }),
    },
    {
      method: 'cancelarVenda',
      correction: true,
      command: cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' }),
    },
  ]);
  assert.ok(results[1].result);
  assert.ok(results[0].result || results[0].code === 'INVALID_STATE');
  const s = f.financial.consultarVenda(f.sale.id);
  assert.equal(s.saldoReceberCentavos, 0);
  assert.equal(s.reembolsosPendentesCentavos, s.recebimentosEfetivosCentavos);
  assert.ok(reconciliarComercial(f.db));
});
test('3D adjustment reversal restores exact stock, preserves audit origin and rejects a second reversal', async (t) => {
  const f = await setup(t);
  const before = f.service.consultarSaldo(f.product.id);
  const loss = f.service.registrarPerda(f.command({ produtoId: f.product.id, quantidade: 1 }));
  const c = cmd({ movimentoId: loss.movimentacaoId, dataEfetiva: '2026-11-01' });
  const result = f.corrections.estornarAjuste(c);
  assert.equal(result.saldo.quantidade, before.quantidade);
  assert.equal(result.saldo.valorTotalCentavos, before.valorTotalCentavos);
  assert.deepEqual(f.corrections.estornarAjuste(c), result);
  assert.throws(
    () => f.corrections.estornarAjuste(cmd(c.dados)),
    (e) => e.code === 'INVALID_STATE',
  );
  const audit = f.db
    .prepare('SELECT * FROM eventos_auditoria WHERE operacao_id=?')
    .get(c.operacaoId);
  assert.equal(audit.documento_id, null);
  assert.equal(audit.produto_id, f.product.id);
  assert.equal(JSON.parse(audit.antes_json).movimento.id, loss.movimentacaoId);
});
test('3D mixed return restores only resale quantity at historical cost and rejects cancellation after partial return', async (t) => {
  const f = await setup(t);
  f.service.registrarEntrada(
    f.command({ produtoId: f.product.id, quantidade: 2, custoTotalCentavos: 5000 }),
  );
  const before = f.service.consultarSaldo(f.product.id);
  f.corrections.devolverVenda(
    cmd({
      documentoId: f.sale.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: f.sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
    }),
  );
  const after = f.service.consultarSaldo(f.product.id);
  assert.equal(after.quantidade, before.quantidade + 1);
  assert.equal(after.valorTotalCentavos, before.valorTotalCentavos + 100);
  assert.throws(
    () => f.corrections.cancelarVenda(cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' })),
    (e) => e.code === 'INVALID_STATE',
  );
});
test('3D SQL protects immutable history, invalid obligations, allocations and dependent receipt reversals', async (t) => {
  const f = await setup(t, 5000);
  f.corrections.cancelarVenda(cmd({ documentoId: f.sale.id, dataEfetiva: '2026-11-01' }));
  for (const table of [
    'alocacoes_recebimento',
    'abatimentos_parcela',
    'reembolsos_cliente',
    'origens_reembolso',
    'movimentos_financeiros',
  ]) {
    assert.throws(() => f.db.exec(`UPDATE ${table} SET valor_centavos=1`), /imutavel/);
    assert.throws(() => f.db.exec(`DELETE FROM ${table}`), /imutavel/);
  }
  assert.throws(
    () =>
      f.db.exec(`UPDATE documentos SET total_centavos=0,subtotal_centavos=0 WHERE id=${f.sale.id}`),
    /imutavel|invalida/,
  );
  assert.throws(() =>
    f.db
      .prepare('INSERT INTO reembolsos_cliente(documento_correcao_id,valor_centavos) VALUES (?,1)')
      .run(f.sale.id),
  );
  assert.throws(() =>
    f.db
      .prepare(
        'INSERT INTO origens_reembolso(reembolso_id,alocacao_recebimento_id,valor_centavos) VALUES (1,1,1)',
      )
      .run(),
  );
  assert.ok(reconciliarComercial(f.db));
});
test('3D tampered returned historical cost blocks reopening and leaves the changed record for diagnosis', async (t) => {
  const f = await setup(t);
  const ret = f.corrections.devolverVenda(
    cmd({
      documentoId: f.sale.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: f.sale.itens[0].id, quantidade: 1, quantidadePerda: 1 }],
    }),
  );
  const trigger = f.db
    .prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='itens_update'")
    .get().sql;
  f.db.exec('DROP TRIGGER itens_update');
  f.db
    .prepare('UPDATE itens_documento SET valor_custo_estoque_centavos=101 WHERE documento_id=?')
    .run(ret.documentoId);
  f.db.exec(trigger);
  assert.equal(reconciliarComercial(f.db), false);
  f.db.close();
  await assert.rejects(openDatabase(f.directory, '3D'), (e) => e.code === 'INTEGRITY');
  const raw = new Database(join(f.directory, 'mnr-perfumes.db'));
  try {
    assert.equal(
      raw
        .prepare('SELECT valor_custo_estoque_centavos v FROM itens_documento WHERE documento_id=?')
        .get(ret.documentoId).v,
      101,
    );
  } finally {
    raw.close();
  }
});
