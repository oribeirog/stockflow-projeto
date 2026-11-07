const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const { cycle, command, day, clock } = require('./helpers/consolidacao-fixture.cjs');
const { seedReembolsos } = require('./helpers/reembolsos-ui-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { createReportService } = require('../dist/electron/services/relatorios');
const { criarHandlersRelatorios } = require('../dist/electron/ipc/relatorios');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { createFinancialQueryService } = require('../dist/electron/services/financeiro-consulta');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const range = { dataInicio: '2026-10-01', dataFim: '2026-12-31' };
const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
};
async function setup(t) {
  const f = await fixture(t);
  return { ...f, s: cycle(f.db), r: createReportService(f.db, clock) };
}
test('4F1 reference 300/250/200/150 through official services; mixed loss, refund payment/reversal, return undo and reopen', async (t) => {
  const { db, s, r, directory } = await setup(t);
  s.buy(20, 100);
  const sale = s.sell();
  const fin = createFinancialService(db, 'test', clock),
    cor = createCorrectionService(db, 'test', clock);
  fin.registrarRecebimento(
    command({
      vendaId: sale.id,
      dataEfetiva: day,
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 15000 }],
    }),
  );
  const check = (commercial, debt, paid, pending, loss = 0) => {
    const v = s.q.obterVenda(sale.id).resumo,
      g = r.obterResumoGerencial(range);
    assert.equal(g.fluxoComercial.faturamentoLiquidoCentavos, commercial);
    assert.equal(g.fluxoComercial.unidadesDevolvidasEfetivas, commercial === 10000 ? 2 : 0);
    assert.equal(g.coorteVendas.comercialLiquidoAtualCentavos, v.valorComercialLiquidoCentavos);
    assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, v.recebidoLiquidoCentavos);
    assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, 25000);
    assert.equal(g.fluxoFinanceiro.reembolsoPagoLiquidoCentavos, paid);
    assert.equal(g.posicaoAtual.contas.exigivelCentavos, debt);
    assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, pending);
    assert.equal(g.fluxoComercial.perdasImpropriosLiquidasCentavos, loss);
    assert.equal(r.listarVendas(range).totais.comercialLiquidoAtualCentavos, commercial);
    assert.equal(r.listarContasReceber({}).totais.exigivelCentavos, debt);
    assert.equal(r.listarReembolsos({}).totais.pendenteCentavos, pending);
  };
  check(30000, 5000, 0, 0);
  s.buy(5, 10000);
  const returned = cor.devolverVenda(
    command({
      documentoId: sale.id,
      dataEfetiva: day,
      itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
    }),
  );
  check(10000, 0, 0, 15000, 100);
  assert.equal(r.obterResumoGerencial(range).fluxoComercial.cmvHistoricoLiquidoCentavos, 100);
  assert.equal(r.obterResumoGerencial(range).fluxoComercial.resultadoBrutoEstimadoCentavos, 9800);
  const refundId = s.q.obterDocumento({ vendaId: sale.id, documentoId: returned.documentoId })
    .reembolsoIds[0];
  const payment = fin.pagarReembolso(
    command({
      reembolsoId: refundId,
      dataEfetiva: day,
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 10000 }],
    }),
  );
  check(10000, 0, 10000, 5000, 100);
  fin.estornarReembolso(command({ movimentoId: payment.movimentos[0], dataEfetiva: day }));
  check(10000, 0, 0, 15000, 100);
  const full = fin.pagarReembolso(
    command({
      reembolsoId: refundId,
      dataEfetiva: day,
      pagamentos: [
        { formaPagamentoId: s.pix, valorCentavos: 9000 },
        { formaPagamentoId: s.cash, valorCentavos: 6000 },
      ],
    }),
  );
  check(10000, 0, 15000, 0, 100);
  assert.equal(r.listarReembolsos({ situacao: 'QUITADAS' }).totais.obrigacoesQuitadas, 1);
  fin.estornarReembolso(command({ movimentoId: full.movimentos[0], dataEfetiva: day }));
  check(10000, 0, 6000, 9000, 100);
  assert.equal(r.listarTotaisPorForma(range).totais.reembolsoPagoLiquidoCentavos, 6000);
  fin.estornarReembolso(command({ movimentoId: full.movimentos[1], dataEfetiva: day }));
  check(10000, 0, 0, 15000, 100);
  cor.estornarDevolucao(command({ documentoId: returned.documentoId, dataEfetiva: day }));
  check(30000, 5000, 0, 0);
  assert.equal(r.listarReembolsos({ situacao: 'ANULADAS' }).itens[0].ativa, false);
  const before = snapshot(db);
  db.close();
  const reopened = await openDatabase(directory, 'test');
  try {
    assert.equal(snapshot(reopened), before);
    const rr = createReportService(reopened, clock);
    assert.equal(rr.obterResumoGerencial(range).posicaoAtual.contas.exigivelCentavos, 5000);
    assert.equal(snapshot(reopened), before);
  } finally {
    reopened.close();
  }
});
test('4F1 aggregates independently match every official sale/installment/refund, cash, credit, entry, successive and cancelled sales', async (t) => {
  const { db, s, r } = await setup(t);
  const ids = seedReembolsos(db);
  s.buy(40, 100);
  const sales = [s.sell('cash'), s.sell('credit'), s.sell()];
  const cor = createCorrectionService(db, 'test', clock),
    fin = createFinancialService(db, 'test', clock);
  for (const [q, loss] of [
    [1, 0],
    [2, 2],
  ])
    cor.devolverVenda(
      command({
        documentoId: sales[0].id,
        dataEfetiva: day,
        itens: [{ itemId: sales[0].itens[0].id, quantidade: q, quantidadePerda: loss }],
      }),
    );
  cor.cancelarVenda(command({ documentoId: sales[1].id, dataEfetiva: day }));
  const receipts = fin.registrarRecebimento(
    command({
      vendaId: sales[2].id,
      dataEfetiva: day,
      pagamentos: [
        { formaPagamentoId: s.pix, valorCentavos: 6000 },
        { formaPagamentoId: s.cash, valorCentavos: 4000 },
      ],
    }),
  );
  fin.estornarRecebimento(command({ movimentoId: receipts.movimentos[0], dataEfetiva: day }));
  const query = createFinancialQueryService(db, clock);
  const all = db
    .prepare(
      "SELECT id FROM documentos WHERE tipo='VENDA' AND estado IN ('CONFIRMADO','ESTORNADO')",
    )
    .all();
  const official = all.map((x) => query.obterVenda(x.id).resumo);
  const g = r.obterResumoGerencial(range);
  const sum = (field) => official.reduce((n, x) => n + x[field], 0);
  assert.equal(g.fluxoComercial.faturamentoLiquidoCentavos, sum('valorComercialLiquidoCentavos'));
  assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, sum('recebidoLiquidoCentavos'));
  assert.equal(g.posicaoAtual.contas.exigivelCentavos, sum('saldoReceberCentavos'));
  assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, sum('reembolsosPendentesCentavos'));
  const eligible = official.filter((x) => x.valorComercialLiquidoCentavos > 0).length;
  assert.equal(g.coorteVendas.vendasComValorPositivo, eligible);
  assert.equal(
    g.coorteVendas.ticketMedioCentavos,
    Number(
      (2n * BigInt(sum('valorComercialLiquidoCentavos')) + BigInt(eligible)) /
        (2n * BigInt(eligible)),
    ),
  );
  const pages = r.listarVendas({ ...range, limite: 2 }),
    next = r.listarVendas({ ...range, limite: 2, deslocamento: 2 });
  assert.equal(pages.temMais, true);
  assert.deepEqual(pages.totais, next.totais);
  assert.notEqual(pages.itens[0].vendaId, next.itens[0].vendaId);
  assert.equal(pages.totais.vendas, all.length);
  for (const p of r.listarContasReceber({ limite: 200 }).itens) {
    const off = query.obterParcela(p.id);
    assert.equal(p.saldoCentavos, off.saldoCentavos);
    assert.equal(p.status, off.status);
  }
  for (const re of r.listarReembolsos({ limite: 200 }).itens) {
    const off = query.obterReembolso({ vendaId: re.vendaId, reembolsoId: re.id });
    assert.equal(re.pendenteCentavos, off.saldoExigivelCentavos);
    assert.equal(re.pagoLiquidoCentavos, off.pagoLiquidoCentavos);
  }
  assert.equal(
    r
      .listarMovimentos({ ...range, formaPagamentoId: ids.pix })
      .itens.every((x) => x.formaPagamentoId === ids.pix),
    true,
  );
  const series = r.obterSeriesRecebimentos({ ...range, agrupamento: 'DIARIO' });
  assert.equal(
    series.itens.reduce((a, b) => a + b.recebidoLiquidoCentavos, 0),
    g.fluxoFinanceiro.recebidoLiquidoCentavos,
  );
  assert.equal(
    r.listarVendas({ ...range, ordem: 'VALOR_DESC' }).itens[0].comercialLiquidoAtualCentavos,
    30000,
  );
});
test('4F1 effective date flow vs current cohort/position, cross-month/year, empty buckets, historical identities and product attribution', async (t) => {
  const { db, s, r } = await setup(t);
  s.buy(20, 100);
  const sale = s.sell();
  const cor = createCorrectionService(db, 'test', clock);
  const doc = cor.devolverVenda(
    command({
      documentoId: sale.id,
      dataEfetiva: '2026-11-02',
      itens: [{ itemId: sale.itens[0].id, quantidade: 1 }],
    }),
  );
  cor.estornarDevolucao(command({ documentoId: doc.documentoId, dataEfetiva: '2026-11-03' }));
  s.cat.saveProduct(
    command({ ...s.productData, id: s.productId, nome: 'Nome atual inativo', ativo: false }),
  );
  s.cat.savePerson(
    'CLIENTE',
    command({ id: s.clienteId, nome: 'Cliente atual inativo', ativo: false }),
  );
  s.cat.saveReference(
    'FORMA_PAGAMENTO',
    command({ id: s.pix, nome: 'Pix atual inativo', ativo: false }),
  );
  const p = (d) => ({ dataInicio: d, dataFim: d, clienteId: s.clienteId });
  assert.equal(r.obterResumoGerencial(p(day)).fluxoComercial.faturamentoLiquidoCentavos, 30000);
  assert.equal(
    r.obterResumoGerencial(p('2026-11-02')).fluxoComercial.faturamentoLiquidoCentavos,
    -10000,
  );
  assert.equal(
    r.obterResumoGerencial(p('2026-11-03')).fluxoComercial.devolucoesEfetivasCentavos,
    -10000,
  );
  assert.equal(r.obterResumoGerencial(p('2026-11-02')).posicaoAtual.contas.exigivelCentavos, 20000);
  assert.equal(r.listarVendas(p(day)).itens[0].comercialLiquidoAtualCentavos, 30000);
  assert.equal(r.listarVendas(p(day)).itens[0].clienteNomeHistorico, 'Cliente ciclo histórico');
  assert.equal(
    r.listarProdutos({ ...range, produtoId: s.productId }).itens[0].nomeHistorico,
    'Perfume ciclo histórico',
  );
  assert.equal(r.listarMovimentos(range).itens[0].formaHistorica, 'Pix ciclo');
  assert.equal(
    r.listarSaldos({ produtoId: s.productId, ativo: false }).itens[0].nomeAtual,
    'Nome atual inativo',
  );
  assert.equal(
    r.obterResumoEstoque({ ...range, produtoId: s.productId }).posicaoAtual.unidades,
    17,
  );
  const monthly = r.obterSeriesVendas({
    dataInicio: '2026-12-31',
    dataFim: '2027-01-01',
    agrupamento: 'MENSAL',
  });
  assert.deepEqual(
    monthly.itens.map((x) => [x.competencia, x.faturamentoLiquidoCentavos]),
    [
      ['2026-12', 0],
      ['2027-01', 0],
    ],
  );
  assert.equal(
    r.obterResumoGerencial({ dataInicio: '2026-12-31', dataFim: '2027-01-01' }).coorteVendas
      .ticketMedioCentavos,
    null,
  );
  const a = s.cat.saveProduct(command({ ...s.productData, sku: 'SECOND' }));
  s.cat.saveProduct(
    command({ ...s.productData, id: s.productId, nome: 'Nome atual reativado', ativo: true }),
  );
  // A second product gets stock through a purchase, then a two-product sale.
  const purchase = s.com.salvarRascunho(
    command({
      tipo: 'COMPRA',
      fornecedorId: s.fornecedorId,
      dataComercial: day,
      itens: [{ produtoId: a.id, quantidade: 2, valorUnitarioCentavos: 5 }],
    }),
  );
  s.com.confirmar(
    command({
      id: purchase.id,
      versaoEsperada: purchase.versao,
      pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: 10 }],
    }),
  );
  const draft = s.com.salvarRascunho(
    command({
      tipo: 'VENDA',
      modalidadeVenda: 'A_VISTA',
      dataComercial: day,
      itens: [
        {
          produtoId: a.id,
          quantidade: 1,
          valorUnitarioCentavos: 1,
          motivo: 'Promoção de teste abaixo do custo',
        },
        {
          produtoId: s.productId,
          quantidade: 1,
          valorUnitarioCentavos: 10,
          motivo: 'Promoção de teste abaixo do custo',
        },
      ],
    }),
  );
  s.com.confirmar(
    command({
      id: draft.id,
      versaoEsperada: draft.versao,
      pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: 11 }],
    }),
  );
  assert.equal(r.listarVendas({ ...range, produtoId: a.id }).totais.originalCentavos, 1);
  assert.equal(r.obterResumoGerencial(range).fluxoComercial.margemBrutaPontosBase < 10000, true);
});
test('4F1 every endpoint query_only, snapshots, bounded SQL calls, validation and safe integer overflow without writes', async (t) => {
  const { db, s, r } = await setup(t);
  s.buy(20, 100);
  s.sell();
  const handlers = criarHandlersRelatorios(db, clock);
  const inputs = {
    obterResumoGerencial: range,
    obterSeriesVendas: { ...range, agrupamento: 'DIARIO' },
    obterSeriesRecebimentos: { ...range, agrupamento: 'MENSAL' },
    listarVendas: range,
    listarProdutos: range,
    listarClientes: range,
    listarMovimentos: range,
    listarTotaisPorForma: range,
    listarMovimentacaoProdutos: range,
    listarContasReceber: {},
    listarReembolsos: {},
    listarSaldos: {},
    obterResumoEstoque: range,
  };
  const channels = require('../dist/shared/relatorios-ipc').CANAIS_RELATORIOS;
  const before = snapshot(db);
  db.pragma('query_only=ON');
  for (const [method, input] of Object.entries(inputs)) {
    ok(handlers.get(channels[method])(input));
    assert.equal(handlers.get(channels[method])().ok, false);
    for (const malformed of [null, [], 1, 'consulta'])
      assert.equal(handlers.get(channels[method])(malformed).ok, false);
    assert.equal(handlers.get(channels[method])(input, {}).ok, false);
    assert.equal(
      handlers.get(channels[method])({ ...input, sql: 'DROP TABLE produtos' }).ok,
      false,
    );
  }
  for (const [method, input] of [
    ['listarMovimentos', { ...range, formaPagamentoId: '1' }],
    ['listarTotaisPorForma', { ...range, formaPagamentoId: 999999 }],
    ['listarMovimentos', { ...range, natureza: 'SQL' }],
    ['obterSeriesVendas', { ...range, agrupamento: 'ANUAL' }],
    ['listarContasReceber', { situacao: 'SQL' }],
    ['listarContasReceber', { vencimentoDe: '2026-11-02', vencimentoAte: '2026-11-01' }],
    ['listarReembolsos', { vendaId: 999999 }],
    ['listarSaldos', { ativo: 'false' }],
    ['listarSaldos', { ordem: 'nomeAtual' }],
    ['listarMovimentacaoProdutos', { ...range, limite: 201 }],
  ])
    assert.equal(handlers.get(channels[method])(input).ok, false);
  for (const input of [
    { ...range, dataInicio: '2026-02-30' },
    { ...range, dataFim: '2025-01-01' },
    { ...range, dataFim: '2030-01-01' },
    { ...range, limite: 0 },
    { ...range, deslocamento: -1 },
    { ...range, ordem: 'id;DROP TABLE' },
    { ...range, clienteId: 999999 },
    { ...range, produtoId: '1' },
  ])
    assert.equal(handlers.get(channels.listarVendas)(input).ok, false);
  assert.equal(
    handlers.get(channels.listarVendas)({ ...range, clienteId: 999999 }).error.code,
    'NOT_FOUND',
  );
  const prepare = db.prepare.bind(db);
  let count = 0;
  db.prepare = (...args) => {
    count++;
    return prepare(...args);
  };
  try {
    r.obterSeriesVendas({ ...range, agrupamento: 'DIARIO' });
    assert.ok(count <= 4, 'Series must aggregate in a fixed number of statements: ' + count);
  } finally {
    db.prepare = prepare;
  }
  assert.throws(() =>
    db.prepare('WITH v(x) AS (VALUES (9007199254740991),(1)) SELECT mnr_rel_soma(x) FROM v').get(),
  );
  assert.equal(snapshot(db), before);
  db.pragma('query_only=OFF');
});
test('4F1 IPC literal preload methods, main frame/origin guards, public errors and DTOs', async (t) => {
  const { db } = await setup(t),
    vm = require('node:vm'),
    { readFileSync } = require('node:fs'),
    { resolve } = require('node:path');
  const channels = require('../dist/shared/relatorios-ipc').CANAIS_RELATORIOS;
  let api;
  const calls = [],
    registered = new Map();
  vm.runInNewContext(readFileSync('dist/electron/preload/index.cjs', 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_, a) => (api = a) },
      ipcRenderer: {
        invoke: (channel, ...args) => {
          calls.push({ channel, args });
          return Promise.resolve();
        },
      },
    }),
  });
  assert.deepEqual(Object.keys(api.relatorios).sort(), Object.keys(channels).sort());
  for (const [method, channel] of Object.entries(channels)) {
    await api.relatorios[method](range);
    assert.deepEqual(calls.at(-1), { channel, args: [range] });
  }
  assert.equal(api.invoke, undefined);
  const sandbox = {
    exports: {},
    console,
    require: (name) =>
      name === 'electron'
        ? { app: { getVersion: () => 'test' }, ipcMain: { handle: (c, h) => registered.set(c, h) } }
        : require(resolve('dist/electron/ipc', name)),
  };
  vm.runInNewContext(readFileSync('dist/electron/ipc/index.js', 'utf8'), sandbox);
  const frame = { url: 'mnr://app/index.html#/dashboard' },
    window = { webContents: { mainFrame: frame } };
  sandbox.exports.registerIpc(window, db, 'mnr://app/index.html');
  for (const channel of Object.values(channels))
    for (const event of [
      { sender: {}, senderFrame: frame },
      { sender: window.webContents, senderFrame: { url: frame.url } },
      { sender: window.webContents, senderFrame: null },
    ])
      assert.throws(() => registered.get(channel)(event, range));
  const event = { sender: window.webContents, senderFrame: frame };
  frame.url = 'http://evil.invalid';
  assert.throws(() => registered.get(channels.listarVendas)(event, range));
  frame.url = 'mnr://app/index.html';
  assert.equal(registered.get(channels.listarVendas)(event, range, {}).ok, false);
  const prepare = db.prepare;
  db.prepare = () => {
    throw Object.assign(new Error('SQL secret path C:/private/db'), { code: 'SQLITE_ERROR' });
  };
  try {
    const result = registered.get(channels.listarVendas)(event, range);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|private|SELECT|stack/);
  } finally {
    db.prepare = prepare;
  }
  assert.equal(
    JSON.stringify(ok(registered.get(channels.listarVendas)(event, range))).includes('operacao_id'),
    false,
  );
});

test('4F1 actual year boundary and late UTC registration never move commercial/effective days', async (t) => {
  const { db, s } = await setup(t);
  s.buy(20, 100);
  const { createCommercialService } = require('../dist/electron/services/comercial');
  const late = () => new Date('2026-01-02T01:30:00Z');
  const com = createCommercialService(db, 'test', late);
  for (const date of ['2025-12-31', '2026-01-01']) {
    const d = com.salvarRascunho(
      command({
        tipo: 'VENDA',
        modalidadeVenda: 'A_VISTA',
        dataComercial: date,
        itens: [{ produtoId: s.productId, quantidade: 1, valorUnitarioCentavos: 10000 }],
      }),
    );
    com.confirmar(
      command({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: 10000 }],
      }),
    );
  }
  const r = createReportService(db, late),
    p = { dataInicio: '2025-12-31', dataFim: '2026-01-01', agrupamento: 'DIARIO' };
  const series = r.obterSeriesVendas(p);
  assert.deepEqual(
    series.itens.map((x) => [x.competencia, x.faturamentoLiquidoCentavos]),
    [
      ['2025-12-31', 10000],
      ['2026-01-01', 10000],
    ],
  );
  const receipts = r.obterSeriesRecebimentos(p);
  assert.deepEqual(
    receipts.itens.map((x) => x.recebidoLiquidoCentavos),
    [10000, 10000],
  );
  assert.deepEqual(
    r.obterSeriesVendas({ ...p, agrupamento: 'MENSAL' }).itens.map((x) => x.competencia),
    ['2025-12', '2026-01'],
  );
  assert.equal(
    series.dataReferencia,
    require('../dist/electron/services/financeiro').localDay(late()),
  );
});
test('4F1 cumulative historical residual cents and completely returned ticket denominator', async (t) => {
  const { db, s, r } = await setup(t);
  const d = s.com.salvarRascunho(
    command({
      tipo: 'COMPRA',
      fornecedorId: s.fornecedorId,
      dataComercial: day,
      descontoGlobal: { tipo: 'CENTAVOS', valor: 1 },
      itens: [{ produtoId: s.productId, quantidade: 3, valorUnitarioCentavos: 1 }],
    }),
  );
  s.com.confirmar(
    command({
      id: d.id,
      versaoEsperada: d.versao,
      pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: 2 }],
    }),
  );
  const v = s.com.salvarRascunho(
    command({
      tipo: 'VENDA',
      modalidadeVenda: 'A_VISTA',
      dataComercial: day,
      itens: [{ produtoId: s.productId, quantidade: 3, valorUnitarioCentavos: 1 }],
    }),
  );
  const sale = s.com.confirmar(
    command({
      id: v.id,
      versaoEsperada: v.versao,
      pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: 3 }],
    }),
  );
  const cor = createCorrectionService(db, 'test', clock);
  for (const cmv of [1, 1, 0]) {
    cor.devolverVenda(
      command({
        documentoId: sale.id,
        dataEfetiva: day,
        itens: [{ itemId: sale.itens[0].id, quantidade: 1 }],
      }),
    );
    assert.equal(r.obterResumoGerencial(range).fluxoComercial.cmvHistoricoLiquidoCentavos, cmv);
  }
  const g = r.obterResumoGerencial(range);
  assert.equal(g.coorteVendas.ticketMedioCentavos, null);
  assert.equal(g.fluxoComercial.margemBrutaPontosBase, null);
  assert.equal(g.fluxoComercial.faturamentoLiquidoCentavos, 0);
  assert.equal(r.listarClientes(range).totais.clientes, 0); // anonymous sales are not customer identities
  const second = s.cat.savePerson('CLIENTE', command({ nome: 'Outro cliente' }));
  assert.throws(() => r.listarContasReceber({ vendaId: sale.id, clienteId: second.id }));
});

test('4F1 one reference instant per read even when clock crosses local midnight', async (t) => {
  const { db } = await setup(t);
  let calls = 0;
  const first = new Date(2026, 10, 6, 23, 59, 59),
    next = new Date(2026, 10, 7, 0, 0, 1);
  const r = createReportService(db, () => (calls++ ? next : first));
  const g = r.obterResumoGerencial(range);
  assert.equal(calls, 1);
  assert.equal(g.dataReferencia, '2026-11-06');
  assert.equal(g.consultadoEm, first.toISOString());
});

test('4F1 calendar extremes remain bounded and zero-filled at year 9999 and year zero', async (t) => {
  const { r } = await setup(t);
  for (const day of ['9999-12-31', '0000-01-01'])
    for (const agrupamento of ['DIARIO', 'MENSAL']) {
      const serie = r.obterSeriesVendas({ dataInicio: day, dataFim: day, agrupamento });
      assert.equal(serie.itens.length, 1);
      assert.equal(serie.itens[0].faturamentoLiquidoCentavos, 0);
    }
});

test('4F1 overdue vs due-today positions, settlement counts and formal stock minimum', async (t) => {
  const f = await setup(t),
    { db, s, r } = f;
  s.buy(20, 100);
  const d = s.com.salvarRascunho(
    command({
      tipo: 'VENDA',
      modalidadeVenda: 'A_PRAZO',
      clienteId: s.clienteId,
      dataComercial: day,
      itens: [{ produtoId: s.productId, quantidade: 3, valorUnitarioCentavos: 10000 }],
    }),
  );
  const sale = s.com.confirmar(
    command({
      id: d.id,
      versaoEsperada: d.versao,
      parcelas: [
        { vencimento: '2026-11-05', valorCentavos: 15000 },
        { vencimento: '2026-11-06', valorCentavos: 15000 },
      ],
    }),
  );
  let totals = r.listarContasReceber({}).totais;
  assert.equal(totals.vencidoCentavos, 15000);
  assert.equal(totals.aVencerCentavos, 15000);
  assert.equal(totals.parcelasAbertas, 2);
  const fin = createFinancialService(db, 'test', clock);
  fin.registrarRecebimento(
    command({
      vendaId: sale.id,
      dataEfetiva: '2026-11-06',
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 1000 }],
    }),
  );
  assert.equal(r.listarContasReceber({ situacao: 'VENCIDAS' }).totais.exigivelCentavos, 14000);
  assert.equal(r.listarContasReceber({ situacao: 'A_VENCER' }).totais.exigivelCentavos, 15000);
  fin.registrarRecebimento(
    command({
      vendaId: sale.id,
      dataEfetiva: '2026-11-06',
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 14000 }],
    }),
  );
  totals = r.listarContasReceber({}).totais;
  assert.equal(totals.vencidoCentavos, 0);
  assert.equal(totals.parcelasQuitadas, 1);
  assert.equal(totals.parcelasAbertas, 1);
  f.catalog.saveProduct(command({ ...f.productData, id: f.product.id, estoqueMinimo: 5 }));
  assert.equal(r.listarSaldos({ situacao: 'BAIXO' }).itens[0].produtoId, f.product.id);
  assert.equal(r.obterResumoEstoque(range).posicaoAtual.abaixoMinimo, 1);
  assert.equal(r.listarSaldos({ situacao: 'SEM_ESTOQUE' }).totais.semEstoque, 1);
});
