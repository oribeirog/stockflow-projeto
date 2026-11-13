const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { seedComprasCorrecoes, cmd } = require('./helpers/correcoes-compras-fixture.cjs');
const { criarHandlersCorrecoesCompras } = require('../dist/electron/ipc/correcoes-compras');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { openDatabase } = require('../dist/electron/infrastructure/database');
async function setup(t) {
  const f = await fixture(t),
    s = seedComprasCorrecoes(f.db),
    p = s.purchase();
  const handlers = criarHandlersCorrecoesCompras(f.db, 'test', s.clock);
  const call = (m, ...args) => handlers.get('correcoes-compras:' + m)(...args);
  const ok = (m, ...args) => {
    const r = call(m, ...args);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const data = (q = 2, extra = {}) => ({
    documentoId: p.id,
    dataEfetiva: '2026-11-12',
    itens: [{ itemId: p.itens[0].id, quantidade: q }],
    pagamentos: [{ formaPagamentoId: s.form.id, valorCentavos: q * 2000 }],
    ...extra,
  });
  const command = (dados = data(), cancel = false) => ({
    ...cmd(dados),
    revisao: ok(cancel ? 'revisar-cancelamento' : 'revisar-devolucao', {
      motivo: 'Teste isolado de compras',
      dados,
    }).revisao,
  });
  return { ...f, ...s, p, handlers, call, ok, data, command };
}
test('4G1: read-only review/current average versus historical cost, inactive snapshots, successive/integral returns and linked money', async (t) => {
  const s = await setup(t);
  s.purchase(10, 4000);
  s.catalog.saveProduct(
    cmd({ ...s.productData, id: s.product.id, nome: 'Renomeado', ativo: false }),
  );
  s.catalog.savePerson(
    'FORNECEDOR',
    cmd({ id: s.supplier.id, nome: 'Novo fornecedor', ativo: false }),
  );
  const before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  const c = s.ok('obter-contexto', s.p.id),
    r = s.ok('revisar-devolucao', { motivo: 'Teste isolado de compras', dados: s.data() });
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
  assert.equal(c.compra.contraparteNome, 'Fornecedor histórico São João');
  assert.equal(c.itens[0].descricao, s.productData.nome);
  assert.equal(c.cancelavel, false);
  assert.match(c.impedimentoCancelamento, /posterior/);
  assert.equal(r.itens[0].custoCentavos, 6000);
  assert.equal(r.itens[0].valorCentavos, 4000);
  assert.equal(r.itens[0].ajusteCentavos, -2000);
  const original = JSON.stringify(
    s.db.prepare('SELECT * FROM itens_documento WHERE documento_id=?').all(s.p.id),
  );
  const result = s.ok('devolver', s.command()),
    detail = s.ok('obter-documento', { compraId: s.p.id, documentoId: result.documentoId });
  assert.equal(detail.itens[0].ajusteCentavos, -2000);
  assert.equal(detail.movimentosFinanceiros[0].natureza, 'REEMBOLSO_FORNECEDOR');
  assert.equal(detail.movimentosFinanceiros[0].valorCentavos, 4000);
  assert.equal(detail.movimentosEstoque[0].valorDeltaCentavos, -6000);
  s.ok('devolver', s.command(s.data(3)));
  s.ok('devolver', s.command(s.data(5)));
  assert.equal(s.ok('obter-contexto', s.p.id).itens[0].quantidadeDisponivel, 0);
  assert.equal(s.ok('listar-documentos', { compraId: s.p.id, limite: 1 }).temMais, true);
  let ids = [],
    after = 0;
  for (;;) {
    const page = s.ok('listar-documentos', { compraId: s.p.id, limite: 1, aposId: after });
    ids.push(...page.itens.map((d) => d.id));
    if (!page.temMais) break;
    after = ids.at(-1);
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(
    JSON.stringify(s.db.prepare('SELECT * FROM itens_documento WHERE documento_id=?').all(s.p.id)),
    original,
  );
});
test('4G1: 10 bought/4 sold/7 returned refused; 6 allowed; sold historical cost immutable', async (t) => {
  const s = await setup(t),
    sale = s.sale(),
    original = JSON.stringify(
      s.db.prepare('SELECT * FROM itens_documento WHERE documento_id=?').all(sale.id),
    ),
    before = snapshot(s.db);
  assert.equal(
    s.call('revisar-devolucao', { motivo: 'Teste', dados: s.data(7) }).error.code,
    'INSUFFICIENT_STOCK',
  );
  assert.equal(snapshot(s.db), before);
  assert.equal(s.ok('obter-contexto', s.p.id).itens[0].quantidadeDisponivel, 6);
  s.ok('devolver', s.command(s.data(6)));
  assert.equal(
    s.db.prepare('SELECT quantidade FROM saldos_estoque WHERE produto_id=?').get(s.product.id)
      .quantidade,
    0,
  );
  assert.equal(
    JSON.stringify(s.db.prepare('SELECT * FROM itens_documento WHERE documento_id=?').all(sale.id)),
    original,
  );
});
test('4G1: full cancellation includes freight/expenses, preserves original payments, replay after state change and reopen', async (t) => {
  const s = await setup(t),
    dados = { documentoId: s.p.id, dataEfetiva: '2026-11-12' },
    command = s.command(dados, true),
    r = s.ok('cancelar', command),
    before = snapshot(s.db);
  assert.deepEqual(s.ok('cancelar', command), r);
  assert.equal(snapshot(s.db), before);
  const detail = s.ok('obter-documento', { compraId: s.p.id, documentoId: r.documentoId });
  assert.equal(detail.movimentosFinanceiros[0].natureza, 'ESTORNO_FINANCEIRO');
  assert.ok(detail.movimentosFinanceiros[0].estornaMovimentoId);
  s.db.close();
  const reopened = await openDatabase(s.directory, 'test');
  try {
    const handlers = criarHandlersCorrecoesCompras(reopened, 'test', s.clock);
    assert.deepEqual(handlers.get('correcoes-compras:cancelar')(command).data, r);
    assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(reopened.pragma('foreign_key_check'), []);
  } finally {
    reopened.close();
  }
});
test('4G1: multiple products, monetary residues, exact acquisition reversal and zero money', async (t) => {
  const s = await setup(t),
    p = s.purchase(3, 1, {
      itens: [{ produtoId: s.second.id, quantidade: 3, valorUnitarioCentavos: 1 }],
      freteCentavos: 2,
      despesasDiretasCentavos: 1,
    });
  const d = { documentoId: p.id, dataEfetiva: '2026-11-12' };
  const r = s.ok('revisar-cancelamento', { motivo: 'Teste isolado de compras', dados: d });
  assert.equal(r.totalDocumentoCentavos, 6);
  assert.equal(r.itens[0].custoCentavos, 6);
  s.ok('cancelar', s.command(d, true));
  const p2 = s.purchase(3, 1, {
    itens: [{ produtoId: s.second.id, quantidade: 3, valorUnitarioCentavos: 1 }],
    descontoGlobal: { tipo: 'CENTAVOS', valor: 2 },
  });
  let net = 0,
    cost = 0;
  for (let n = 0; n < 3; n++) {
    const raw = {
      documentoId: p2.id,
      dataEfetiva: '2026-11-12',
      itens: [{ itemId: p2.itens[0].id, quantidade: 1 }],
      pagamentos: n === 1 ? [{ formaPagamentoId: s.form.id, valorCentavos: 1 }] : [],
    };
    const rev = s.ok('revisar-devolucao', { motivo: 'Teste isolado de compras', dados: raw });
    net += rev.valorCentavos;
    cost += rev.itens[0].custoCentavos;
    s.ok('devolver', s.command(raw));
  }
  assert.equal(net, 1);
  assert.equal(cost, 1);
  const multi = s.purchase(1, 100, {
    itens: [
      { produtoId: s.product.id, quantidade: 1, valorUnitarioCentavos: 100 },
      { produtoId: s.second.id, quantidade: 2, valorUnitarioCentavos: 200 },
    ],
  });
  const dr = {
    documentoId: multi.id,
    dataEfetiva: '2026-11-12',
    itens: multi.itens.map((i) => ({ itemId: i.id, quantidade: i.quantidade })),
    pagamentos: [{ formaPagamentoId: s.form.id, valorCentavos: 500 }],
  };
  assert.equal(
    s.ok('revisar-devolucao', { motivo: 'Teste isolado de compras', dados: dr }).itens.length,
    2,
  );
  s.ok('devolver', s.command(dr));
});
test('4G1: closed validation boundary, crossed references, dates, forms, UUID/impression and arity never write', async (t) => {
  const s = await setup(t),
    p2 = s.purchase(),
    before = snapshot(s.db),
    data = s.data();
  for (const [, h] of s.handlers)
    for (const args of [[], [null], [{}, {}]]) assert.equal(h(...args).ok, false);
  for (const dados of [
    { ...data, sql: 'SELECT 1' },
    { ...data, path: 'C:/data' },
    { ...data, documentoId: 999999 },
    { ...data, documentoId: '1' },
    ...['2026-02-30', '2026-10-31', '2099-01-01'].map((dataEfetiva) => ({ ...data, dataEfetiva })),
    ...[0, -1, 1.2, 11, 1e12].map((quantidade) => ({
      ...data,
      itens: [{ itemId: data.itens[0].itemId, quantidade }],
    })),
    { ...data, itens: [{ itemId: p2.itens[0].id, quantidade: 1 }] },
    { ...data, itens: [] },
    { ...data, itens: [...data.itens, ...data.itens] },
    { ...data, itens: [{ ...data.itens[0], quantidadePerda: 0 }] },
    { ...data, pagamentos: [] },
    { ...data, pagamentos: [{ formaPagamentoId: 99999, valorCentavos: 4000 }] },
  ])
    assert.equal(
      s.call('revisar-devolucao', { motivo: 'Teste', dados }).ok,
      false,
      JSON.stringify(dados),
    );
  const command = s.command();
  for (const change of [{ operacaoId: 'bad' }, { revisao: 'x' }, { extra: true }])
    assert.equal(s.call('devolver', { ...command, ...change }).ok, false);
  assert.equal(s.call('obter-documento', { compraId: p2.id, documentoId: s.p.id }).ok, false);
  assert.equal(snapshot(s.db), before);
});
test('4G1: stale stock/form review, idempotent lost reply and legacy command compatibility', async (t) => {
  const s = await setup(t),
    command = s.command();
  s.sale(1);
  assert.equal(s.call('devolver', command).error.code, 'VERSION_CONFLICT');
  const fresh = s.command();
  const legacy = createCorrectionService(s.db, 'test', s.clock),
    result = legacy.devolverCompra({
      operacaoId: fresh.operacaoId,
      motivo: fresh.motivo,
      dados: fresh.dados,
    });
  s.purchase(2, 500);
  const before = snapshot(s.db);
  assert.deepEqual(s.ok('devolver', fresh), result);
  assert.equal(snapshot(s.db), before);
  assert.equal(
    s.call('devolver', { ...fresh, motivo: 'Outro motivo' }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  const f = s.command();
  s.catalog.saveReference(
    'FORMA_PAGAMENTO',
    cmd({ id: s.form.id, nome: 'Alterado', ativo: false }),
  );
  assert.equal(s.call('devolver', f).error.code, 'VERSION_CONFLICT');
  assert.equal(
    s.call('revisar-devolucao', { motivo: 'Teste', dados: s.data() }).error.code,
    'INACTIVE_REFERENCE',
  );
});
test('4G1: rollback at documents/items/stock/money/audit retains complete snapshots and retry same command', async (t) => {
  for (const cancel of [false, true]) {
    for (const table of [
      'documentos',
      'itens_documento',
      'movimentacoes_estoque',
      'movimentos_financeiros',
      'eventos_auditoria',
    ]) {
      const s = await setup(t),
        command = s.command(
          cancel ? { documentoId: s.p.id, dataEfetiva: '2026-11-12' } : s.data(),
          cancel,
        ),
        before = snapshot(s.db);
      s.db.exec(
        `CREATE TRIGGER fail_purchase BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected secret SQL/path'); END`,
      );
      const r = s.call(cancel ? 'cancelar' : 'devolver', command);
      assert.equal(r.ok, false);
      assert.doesNotMatch(r.error.message, /injected|SQL|secret/);
      assert.equal(snapshot(s.db), before);
      s.db.exec('DROP TRIGGER fail_purchase');
      s.ok(cancel ? 'cancelar' : 'devolver', command);
    }
  }
});
test('4G1: independent connections serialize competing reviews and same UUID replay without duplicate effects', async (t) => {
  const { Worker } = require('node:worker_threads'),
    { resolve } = require('node:path');
  async function race(s, commands) {
    const gate = new SharedArrayBuffer(4),
      workers = commands.map(
        (command) =>
          new Worker(resolve('tests/helpers/correcoes-compras-worker.cjs'), {
            workerData: { directory: s.directory, gate, command },
          }),
      );
    try {
      await Promise.all(
        workers.map(
          (w) =>
            new Promise((res, rej) => {
              w.once('message', (m) => (m.ready ? res() : rej(Error('Not ready'))));
              w.once('error', rej);
            }),
        ),
      );
      const results = workers.map(
        (w) =>
          new Promise((res, rej) => {
            w.once('message', res);
            w.once('error', rej);
          }),
      );
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      return await Promise.all(results);
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  }
  const s = await setup(t),
    c = s.command(),
    r = await race(s, [c, { ...c, operacaoId: randomUUID() }]);
  assert.equal(r.filter((x) => x.result).length, 1);
  assert.equal(r.filter((x) => x.code === 'VERSION_CONFLICT').length, 1);
  const next = s.command(),
    same = await race(s, [next, next]);
  assert.ok(same.every((x) => x.result));
  assert.deepEqual(same[0], same[1]);
  assert.equal(s.ok('obter-contexto', s.p.id).itens[0].quantidadeDevolvida, 4);
  assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(s.db.pragma('foreign_key_check'), []);
});
test('4G1: cancellation query_only and blocked consumed/returned/draft/already cancelled states; zero-valued documents', async (t) => {
  const s = await setup(t),
    d = { documentoId: s.p.id, dataEfetiva: '2026-11-12' },
    before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  s.ok('revisar-cancelamento', { motivo: 'Consulta', dados: d });
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
  s.sale(1);
  assert.equal(
    s.call('revisar-cancelamento', { motivo: 'Teste', dados: d }).error.code,
    'INVALID_STATE',
  );
  s.ok('devolver', s.command());
  assert.match(s.ok('obter-contexto', s.p.id).impedimentoCancelamento, /devolução/);
  const p = s.purchase(1, 0, {
    itens: [
      {
        produtoId: s.second.id,
        quantidade: 1,
        valorUnitarioCentavos: 0,
        motivo: 'Bonificação de teste',
      },
    ],
  });
  const dados = { documentoId: p.id, dataEfetiva: '2026-11-12' };
  s.ok('cancelar', s.command(dados, true));
  assert.equal(
    s.call('revisar-cancelamento', { motivo: 'Teste', dados }).error.code,
    'INVALID_STATE',
  );
  const draft = s.commercial.salvarRascunho(
    cmd({
      tipo: 'COMPRA',
      dataComercial: '2026-11-12',
      itens: [{ produtoId: s.second.id, quantidade: 1, valorUnitarioCentavos: 1 }],
    }),
  );
  assert.equal(
    s.call('revisar-cancelamento', { motivo: 'Teste', dados: { ...dados, documentoId: draft.id } })
      .error.code,
    'INVALID_STATE',
  );
});
test('4G1: official stock indicators and exported XLSX reflect correction without changing sales cash metrics', async (t) => {
  const s = await setup(t),
    { createReportService } = require('../dist/electron/services/relatorios'),
    { coletarDocumento } = require('../dist/electron/services/exportacoes/documento'),
    { gerarExcel } = require('../dist/electron/services/exportacoes/xlsx'),
    ExcelJS = require('exceljs');
  const reports = createReportService(s.db, s.clock),
    range = { dataInicio: '2026-11-01', dataFim: '2026-11-12' };
  s.ok('devolver', s.command());
  const before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  const stock = reports.obterResumoEstoque(range);
  assert.equal(stock.posicaoAtual.unidades, 8);
  assert.equal(stock.posicaoAtual.valorCentavos, 16000);
  const g = reports.obterResumoGerencial(range);
  assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, 0);
  const documento = coletarDocumento(s.db, { modelo: 'ESTOQUE', filtros: {} }, s.clock),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await gerarExcel(documento));
  const values = [];
  for (const sheet of wb.worksheets)
    sheet.eachRow((row) => row.eachCell((c) => values.push(c.value)));
  assert(values.includes(160));
  assert(values.includes(8));
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
});
