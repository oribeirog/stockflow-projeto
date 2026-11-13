const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const { stockCycle, command, day, clock } = require('./helpers/consolidacao-estoque-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { reconciliarEstoque } = require('../dist/electron/services/estoque-reconciliation');
const { reconciliarFinanceiro } = require('../dist/electron/services/financeiro-reconciliation');
const { createReportService } = require('../dist/electron/services/relatorios');
const { openDatabase } = require('../dist/electron/infrastructure/database');
function ledger(s) {
  for (const p of s.db.prepare('SELECT * FROM saldos_estoque').all()) {
    const ms = s.db
      .prepare('SELECT * FROM movimentacoes_estoque WHERE produto_id=? ORDER BY id')
      .all(p.produto_id);
    let q = 0n,
      v = 0n,
      version = 0;
    for (const m of ms) {
      q += BigInt(m.quantidade_delta);
      v += BigInt(m.valor_delta_centavos);
      assert(q >= 0n && v >= 0n);
      assert.equal(q, BigInt(m.quantidade_apos));
      assert.equal(v, BigInt(m.valor_apos_centavos));
      assert.equal(++version, m.versao_apos);
      if (q === 0n) assert.equal(v, 0n);
    }
    assert.equal(q, BigInt(p.quantidade));
    assert.equal(v, BigInt(p.valor_total_centavos));
    assert.equal(version, p.versao);
  }
  assert(reconciliarEstoque(s.db).consistente);
  assert(reconciliarFinanceiro(s.db));
  assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(s.db.pragma('foreign_key_check'), []);
  assert.equal(
    s.db.prepare("SELECT count(*) n FROM operacoes WHERE resultado_json='null'").get().n,
    0,
  );
  if (s.state.originalSale)
    assert.equal(
      JSON.stringify(
        s.db
          .prepare('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id')
          .all(s.state.sale.id),
      ),
      s.state.originalSale,
    );
}
test('4G3 complete purchase/valuation/sale/refund/adjustment chain, official positions and reopen', async (t) => {
  const f = await fixture(t),
    s = stockCycle(f.db),
    reports = createReportService(f.db, clock),
    expected = [
      [10, 20000],
      [20, 60000],
      [18, 54000],
      [15, 45000],
      [16, 48000],
      [16, 48000],
      [16, 48000],
      [15, 45000],
      [13, 39000],
      [13, 39000],
    ];
  let index = 0;
  for (const [label, run] of s.steps) {
    run();
    ledger(s);
    const b = s.stock.consultarSaldo(s.productId);
    assert.deepEqual([b.quantidade, b.valorTotalCentavos], expected[index++], label);
    const before = snapshot(f.db);
    f.db.pragma('query_only=ON');
    const rg = reports.obterResumoGerencial({ dataInicio: day, dataFim: '2026-11-30' }),
      es = reports.obterResumoEstoque({ dataInicio: day, dataFim: '2026-11-30' });
    f.db.pragma('query_only=OFF');
    assert.equal(snapshot(f.db), before);
    if (s.state.sale) {
      const financial = s.q.obterVenda(s.state.sale.id).resumo;
      assert.equal(
        rg.coorteVendas.comercialLiquidoAtualCentavos,
        financial.valorComercialLiquidoCentavos,
      );
      assert.equal(rg.fluxoFinanceiro.recebidoLiquidoCentavos, financial.recebidoLiquidoCentavos);
      assert.equal(
        rg.fluxoFinanceiro.reembolsoPagoLiquidoCentavos,
        financial.reembolsoPagoLiquidoCentavos,
      );
      assert.equal(rg.posicaoAtual.contas.exigivelCentavos, financial.saldoReceberCentavos);
      assert.equal(
        rg.posicaoAtual.reembolsos.pendenteCentavos,
        financial.reembolsosPendentesCentavos,
      );
    }
    const balances = f.db
      .prepare('SELECT quantidade,valor_total_centavos FROM saldos_estoque')
      .all();
    assert.equal(
      BigInt(es.posicaoAtual.unidades),
      balances.reduce((a, b) => a + BigInt(b.quantidade), 0n),
    );
    assert.equal(
      BigInt(es.posicaoAtual.valorCentavos),
      balances.reduce((a, b) => a + BigInt(b.valor_total_centavos), 0n),
    );
    if (label === 'devolucao-compra') {
      const row = f.db
        .prepare('SELECT * FROM itens_documento WHERE documento_id=?')
        .get(s.state.returned.documentoId);
      assert.equal(row.valor_liquido_centavos, 4000);
      assert.equal(row.valor_custo_estoque_centavos, 6000);
      assert.equal(row.resultado_ajuste_centavos, -2000);
      assert.equal(rg.fluxoFinanceiro.recebidoLiquidoCentavos, 0);
    }
    if (['devolucao-venda', 'pagamento-reembolso', 'estorno-reembolso'].includes(label)) {
      assert.equal(rg.fluxoComercial.cmvHistoricoLiquidoCentavos, 3000);
      assert.equal(rg.fluxoComercial.perdasImpropriosLiquidasCentavos, 3000);
      assert.equal(rg.fluxoComercial.resultadoBrutoEstimadoCentavos, 4000);
      const r = s.q.obterVenda(s.state.sale.id).resumo;
      assert.equal(r.valorComercialLiquidoCentavos, 10000);
      assert.equal(r.recebidoLiquidoCentavos, 25000);
      assert.equal(r.saldoReceberCentavos, 0);
      assert.equal(r.reembolsosPendentesCentavos, label === 'pagamento-reembolso' ? 5000 : 15000);
    }
  }
  assert.equal(s.state.noDifference.movimentacaoId, null);
  assert.equal(s.stock.consultarSaldo(s.manual.id).valorTotalCentavos, 1000);
  assert.equal(s.stock.consultarSaldo(s.cancelProduct.id).quantidade, 0);
  const sale = s.q.obterVenda(s.state.sale.id).resumo;
  assert.equal(sale.saldoReceberCentavos, 5000);
  assert.equal(sale.valorComercialLiquidoCentavos, 30000);
  assert.equal(sale.reembolsosPendentesCentavos, 0);
  assert.equal(sale.recebidoLiquidoCentavos, 25000);
  const original = s.com.consultar(s.state.first.id);
  assert.equal(original.contraparteNome, 'Fornecedor ciclo');
  assert.equal(original.itens[0].descricaoHistorica, 'Perfume ciclo histórico');
  const before = snapshot(f.db);
  f.db.close();
  const db = await openDatabase(f.directory, 'test');
  try {
    assert.equal(snapshot(db), before);
    assert(reconciliarEstoque(db).consistente);
    assert(reconciliarFinanceiro(db));
  } finally {
    db.close();
  }
});
test('4G3 forbidden cross-module operations and complete rollback of a mixed ledger', async (t) => {
  const f = await fixture(t),
    s = stockCycle(f.db);
  for (const [, run] of s.steps.slice(0, 5)) run();
  const reject = (fn) => {
    const before = snapshot(f.db);
    assert.throws(fn);
    assert.equal(snapshot(f.db), before);
    ledger(s);
  };
  reject(() =>
    s.buyCorrections.revisarCancelamento({
      motivo: 'Bloqueado',
      dados: { documentoId: s.state.first.id, dataEfetiva: day },
    }),
  );
  reject(() =>
    s.reversals.obterAjuste({
      produtoId: s.productId,
      movimentoId: f.db
        .prepare(
          "SELECT id FROM movimentacoes_estoque WHERE produto_id=? AND natureza='COMPRA' LIMIT 1",
        )
        .get(s.productId).id,
    }),
  );
  const loss = s.stock.registrarPerda(s.stockCommand({ produtoId: s.productId, quantidade: 15 }));
  reject(() =>
    s.buyCorrections.revisarDevolucao({
      motivo: 'Saldo insuficiente',
      dados: s.returnData(s.state.second, 2),
    }),
  );
  s.reversals.estornar(s.reviewStock(loss, s.productId));
  for (const target of [
    'documentos',
    'itens_documento',
    'movimentacoes_estoque',
    'saldos_estoque',
    'vinculos_estoque_comercial',
    'movimentos_financeiros',
    'eventos_auditoria',
    'operacoes',
  ]) {
    const c = s.reviewBuy(s.returnData(s.state.first, 1)),
      before = snapshot(f.db);
    const clause =
      target === 'saldos_estoque'
        ? 'AFTER UPDATE'
        : target === 'operacoes'
          ? 'BEFORE UPDATE OF resultado_json'
          : 'BEFORE INSERT';
    f.db.exec(
      `CREATE TRIGGER fail_cross_module ${clause} ON ${target} BEGIN SELECT RAISE(ABORT,'test failure'); END`,
    );
    assert.throws(() => s.buyCorrections.devolver(c));
    assert.equal(snapshot(f.db), before);
    f.db.exec('DROP TRIGGER fail_cross_module');
    ledger(s);
  }
});
test('4G3 independent commercial writers invalidate purchase/adjustment reviews, excessive parallel returns and durable replay', async (t) => {
  const { Worker } = require('node:worker_threads'),
    { resolve } = require('node:path');
  async function race(s, jobs) {
    const gate = new SharedArrayBuffer(4),
      ws = jobs.map(
        (j) =>
          new Worker(resolve('tests/helpers/consolidacao-estoque-worker.cjs'), {
            workerData: {
              directory: s.directory,
              gate,
              product: s.productId,
              supplier: s.fornecedorId,
              form: s.cash,
              ...j,
            },
          }),
      );
    try {
      await Promise.all(
        ws.map(
          (w) =>
            new Promise((r, j) => {
              w.once('message', (m) => (m.ready ? r() : j(Error('not ready'))));
              w.once('error', j);
            }),
        ),
      );
      const answers = ws.map(
        (w) =>
          new Promise((r, j) => {
            w.once('message', r);
            w.once('error', j);
          }),
      );
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      return await Promise.all(answers);
    } finally {
      await Promise.all(ws.map((w) => w.terminate()));
    }
  }
  const f = await fixture(t),
    s = Object.assign(stockCycle(f.db), { directory: f.directory }),
    p = s.buy(10, 2000);
  const old = s.reviewBuy(s.returnData(p, 2));
  assert((await race(s, [{ action: 'sale' }]))[0].result);
  let before = snapshot(f.db);
  assert.throws(
    () => s.buyCorrections.devolver(old),
    (e) => e.code === 'VERSION_CONFLICT',
  );
  assert.equal(snapshot(f.db), before);
  const current = s.reviewBuy(s.returnData(p, 6)),
    jobs = [
      { action: 'return', command: current },
      { action: 'return', command: { ...current, operacaoId: randomUUID() } },
    ],
    results = await race(s, jobs);
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VERSION_CONFLICT').length, 1);
  const winner = jobs[results.findIndex((r) => r.result)].command,
    result = results.find((r) => r.result).result;
  before = snapshot(f.db);
  assert.deepEqual(s.buyCorrections.devolver(winner), result);
  assert.equal(snapshot(f.db), before);
  assert.throws(
    () => s.buyCorrections.devolver({ ...winner, motivo: 'Alterado' }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
  // Distinct product: cancellation was eligible before the other connection bought more.
  const purchase = s.buyProduct(s.manual.id, 2, 2000),
    cancel = s.reviewBuy({ documentoId: purchase.id, dataEfetiva: day }, true);
  assert((await race(s, [{ action: 'buy', product: s.manual.id }]))[0].result);
  before = snapshot(f.db);
  assert.throws(
    () => s.buyCorrections.cancelar(cancel),
    (e) => e.code === 'VERSION_CONFLICT',
  );
  assert.equal(snapshot(f.db), before);
  const adjustment = s.stock.registrarEntrada(
      s.stockCommand({ produtoId: s.manual.id, quantidade: 1, custoTotalCentavos: 1 }),
    ),
    reversal = s.reviewStock(adjustment);
  assert((await race(s, [{ action: 'buy', product: s.manual.id }]))[0].result);
  before = snapshot(f.db);
  assert.throws(
    () => s.reversals.estornar(reversal),
    (e) => e.code === 'VERSION_CONFLICT',
  );
  assert.equal(snapshot(f.db), before);
  assert.equal(
    s.reversals.obterAjuste({ produtoId: s.manual.id, movimentoId: adjustment.movimentacaoId })
      .elegivel,
    false,
  );
  ledger(s);
  f.db.close();
  const db = await openDatabase(f.directory, 'test');
  try {
    const {
      createPurchaseCorrectionService,
    } = require('../dist/electron/services/correcoes-compras');
    assert.deepEqual(createPurchaseCorrectionService(db, 'test').devolver(winner), result);
    assert(reconciliarEstoque(db).consistente);
  } finally {
    db.close();
  }
});
test('4G3 purchase return during paginated stock export retains one WAL snapshot and complete XLSX', async (t) => {
  const f = await fixture(t),
    s = stockCycle(f.db),
    p = s.buy(10, 2000);
  f.db.transaction(() => {
    for (let n = 0; n < 205; n++) {
      const product = s.cat.saveProduct(
        command({ ...s.productData, sku: `PAGE-${n}`, nome: `Produto de paginação ${n}` }),
      );
      s.stock.registrarEntrada(
        s.stockCommand({ produtoId: product.id, quantidade: 1, custoTotalCentavos: 1 }),
      );
    }
  })();
  const writer = await openDatabase(f.directory, 'test');
  t.after(() => writer.close());
  const {
      createPurchaseCorrectionService,
    } = require('../dist/electron/services/correcoes-compras'),
    service = createPurchaseCorrectionService(writer, 'test', clock),
    dados = s.returnData(p, 2),
    e = command(dados),
    intent = { ...e, revisao: service.revisarDevolucao({ motivo: e.motivo, dados }).revisao };
  const { coletarDocumento } = require('../dist/electron/services/exportacoes/documento');
  let changed = false;
  f.db.pragma('query_only=ON');
  const d = coletarDocumento(f.db, { modelo: 'ESTOQUE', filtros: {} }, clock, () => {
    if (!changed) {
      changed = true;
      service.devolver(intent);
    }
  });
  f.db.pragma('query_only=OFF');
  assert(changed);
  const rows = d.secoes.find((r) => r.nome === 'Estoque').linhas;
  assert(rows.length > 200);
  assert.deepEqual(
    rows.map((r) => r[0]).sort((a, b) => a - b),
    f.db
      .prepare('SELECT id FROM produtos ORDER BY id')
      .all()
      .map((r) => r.id),
    'All product IDs occur exactly once across export pages',
  );
  const original = rows.find((r) => r[0] === s.productId);
  assert.equal(original[4], 10);
  assert.equal(original[5], 20000);
  assert(d.secoes[0].linhas.some((r) => r[1]?.valor === 20205));
  assert.equal(s.stock.consultarSaldo(s.productId).quantidade, 8);
  assert.equal(s.stock.consultarSaldo(s.productId).valorTotalCentavos, 16000);
  assert.equal(
    createReportService(f.db, clock).obterResumoEstoque({ dataInicio: day, dataFim: day })
      .posicaoAtual.valorCentavos,
    16205,
  );
  const { gerarExcel } = require('../dist/electron/services/exportacoes/xlsx'),
    ExcelJS = require('exceljs'),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await gerarExcel(d));
  assert(wb.getWorksheet('Estoque').rowCount > 200);
  require('node:fs').mkdirSync('.cache', { recursive: true });
  require('node:fs').writeFileSync(
    '.cache/4g3-snapshot-input.json',
    JSON.stringify({ documento: d, database: f.db.name, during: 20205, after: 16205 }),
  );
  ledger(s);
});
