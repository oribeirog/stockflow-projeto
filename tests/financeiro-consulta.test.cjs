const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const { seedFinanceiro, snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { criarHandlersConsultasFinanceiras } = require('../dist/electron/ipc/financeiro');
const { CANAIS_FINANCEIRO } = require('../dist/shared/financeiro-ipc');
const { CANAIS_CORRECOES } = require('../dist/shared/correcoes-ipc');
const { createFinancialService } = require('../dist/electron/services/financeiro');
async function setup(t) {
  const f = await fixture(t),
    ids = seedFinanceiro(f.db);
  const handlers = criarHandlersConsultasFinanceiras(f.db, () => new Date('2026-11-03T15:00:00Z'));
  const call = (m, v) => handlers.get({ ...CANAIS_FINANCEIRO, ...CANAIS_CORRECOES }[m])(v);
  const ok = (m, v) => {
    const r = call(m, v);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  return { ...f, ids, handlers, call, ok };
}
test('financial projections preserve official 3D values, historical snapshots, technical installments, refunds and reversal links without writes', async (t) => {
  const s = await setup(t),
    { ids } = s,
    official = createFinancialService(s.db, 'test');
  const before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  for (const id of [ids.integrated, ids.annulledSale, ids.cancelledSale, ids.cash, ids.overdue]) {
    const d = s.ok('obterVenda', id);
    for (const [key, value] of Object.entries(official.consultarVenda(id)))
      assert.equal(d.resumo[key], value, key);
    assert.equal(d.clienteNomeHistorico, 'Cliente histórico financeiro');
    assert.equal(d.clienteAtivo, false);
  }
  const r = s.ok('obterVenda', ids.integrated).resumo;
  assert.equal(r.valorOriginalCentavos, 30000);
  assert.equal(r.valorComercialLiquidoCentavos, 10000);
  assert.equal(r.recebidoLiquidoCentavos, 25000);
  assert.equal(r.saldoReceberCentavos, 0);
  assert.equal(r.obrigacoesAtivasCentavos, 15000);
  assert.equal(r.reembolsosPendentesCentavos, 15000);
  const active = s.ok('obterReembolso', { vendaId: ids.integrated, reembolsoId: ids.active });
  assert.equal(active.pagosCentavos, 10000);
  assert.equal(active.estornosCentavos, 10000);
  assert.equal(active.pagoLiquidoCentavos, 0);
  assert.equal(active.saldoExigivelCentavos, 15000);
  assert.ok(active.origens.length);
  const cancelled = s.ok('obterReembolso', {
    vendaId: ids.annulledSale,
    reembolsoId: ids.annulled,
  });
  assert.equal(cancelled.ativa, false);
  assert.equal(cancelled.valorOriginalCentavos, 10000);
  assert.equal(cancelled.saldoExigivelCentavos, 0);
  const m = s.ok('obterMovimento', { vendaId: ids.integrated, movimentoId: ids.refundPayment });
  assert.equal(m.formaHistorica, 'Pix histórico financeiro');
  assert.equal(m.estornadoPorId, ids.refundReversal);
  assert.ok(m.alocacoes.every((a) => a.reembolsoId === ids.active));
  assert.equal(
    s.ok('obterMovimento', { vendaId: ids.integrated, movimentoId: ids.refundReversal })
      .estornaMovimentoId,
    m.id,
  );
  const docs = s.ok('listarDocumentos', { vendaId: ids.annulledSale });
  assert.deepEqual(
    docs.itens.map((x) => x.categoria),
    ['ESTORNO_DEVOLUCAO', 'DEVOLUCAO_VENDA'],
  );
  const c = s.ok('obterDocumento', { vendaId: ids.integrated, documentoId: ids.correction });
  assert.equal(c.itens[0].descricaoHistorica, 'Perfume histórico financeiro');
  assert.equal(c.itens[0].quantidadePerda, 1);
  assert.equal(c.movimentosEstoque.length, 3);
  assert.deepEqual(c.reembolsoIds, [ids.active]);
  assert.equal(
    s.ok('obterDocumento', { vendaId: ids.annulledSale, documentoId: ids.annulledReturn })
      .estornadoPorId,
    ids.undo,
  );
  assert.equal(
    s.ok('obterDocumento', { vendaId: ids.cancelledSale, documentoId: ids.cancellation }).categoria,
    'CANCELAMENTO_VENDA',
  );
  assert.equal(s.ok('obterContextoVenda', ids.integrated).itens[0].quantidadeDisponivel, 1);
  for (const id of [ids.integrated, ids.cash]) {
    const ps = s.ok('listarParcelas', { vendaId: id, situacao: 'TODAS' }).itens;
    assert.equal(ps[0].saldoCentavos, 0);
    assert.equal(ps[0].tipo, id === ids.cash ? 'REGULAR' : 'ENTRADA');
    assert.equal(
      ps.reduce((n, p) => n + p.recebimentosCentavos, 0),
      id === ids.cash ? 10000 : 25000,
    );
    for (const p of ps) assert.equal(s.ok('obterParcela', p.id).saldoCentavos, p.saldoCentavos);
  }
  assert.equal(snapshot(s.db), before);
});
test('filters precede real pagination and preserve overdue partial status, local date, ordering, boundaries and empty pages', async (t) => {
  const s = await setup(t);
  const official = createFinancialService(s.db, 'test', () => new Date('2026-11-03T15:00:00Z'));
  const expected = s.db
    .prepare(
      "SELECT id FROM documentos WHERE tipo='VENDA' AND estado IN ('CONFIRMADO','ESTORNADO')",
    )
    .all()
    .flatMap((d) => official.listarParcelas(d.id).map((p) => ({ ...p, vendaId: d.id })));
  expected.sort(
    (a, b) =>
      a.vencimento.localeCompare(b.vencimento) ||
      a.vendaId - b.vendaId ||
      a.numero - b.numero ||
      a.id - b.id,
  );
  for (const state of [
    'PENDENTE',
    'PARCIALMENTE_PAGO',
    'QUITADO',
    'VENCIDO',
    'EM_ABERTO',
    'TODAS',
  ]) {
    const full = s.ok('listarParcelas', { situacao: state, limite: 200 });
    assert.deepEqual(
      full.itens.map((p) => p.id),
      expected
        .filter(
          (p) =>
            state === 'TODAS' ||
            (state === 'EM_ABERTO'
              ? p.saldoCentavos > 0
              : state === 'PARCIALMENTE_PAGO'
                ? p.recebimentoParcial
                : p.status === state),
        )
        .map((p) => p.id),
    );
    const pieces = [];
    for (let offset = 0; offset < full.itens.length + 2; offset += 2) {
      const r = s.ok('listarParcelas', { situacao: state, limite: 2, deslocamento: offset });
      assert.equal(r.dataReferencia, '2026-11-03');
      assert.equal(r.temMais, offset + 2 < full.itens.length);
      pieces.push(...r.itens);
    }
    assert.deepEqual(pieces, full.itens);
  }
  const overdue = s.ok('listarParcelas', {
    vendaId: s.ids.overdue,
    situacao: 'PARCIALMENTE_PAGO',
    limite: 1,
  });
  assert.equal(overdue.itens[0].status, 'VENCIDO');
  assert.equal(overdue.itens[0].recebimentoParcial, true);
  const partial = s.ok('listarParcelas', { vendaId: s.ids.partial, situacao: 'PARCIALMENTE_PAGO' });
  assert.equal(partial.itens[0].status, 'PARCIALMENTE_PAGO');
  assert.equal(
    s.ok('listarParcelas', {
      clienteId: s.ids.client,
      vendaId: s.ids.overdue,
      vencimentoDe: '2099-01-01',
      vencimentoAte: '2099-01-01',
    }).itens.length,
    1,
  );
  assert.equal(s.ok('listarParcelas', { clienteId: 999999 }).itens.length, 0);
  assert.equal(s.ok('listarParcelas', { deslocamento: 1000000000 }).itens.length, 0);
  const ids = s.ok('listarParcelas', { situacao: 'TODAS', limite: 200 }).itens;
  assert.deepEqual(
    ids,
    [...ids].sort(
      (a, b) =>
        a.vencimento.localeCompare(b.vencimento) ||
        a.vendaId - b.vendaId ||
        a.numero - b.numero ||
        a.id - b.id,
    ),
  );
  for (const situacao of ['ATIVAS', 'PENDENTES', 'QUITADAS', 'ANULADAS', 'TODAS']) {
    const all = s.ok('listarReembolsos', { situacao, limite: 200 }).itens;
    assert.deepEqual(
      all.flatMap(
        (_, i) => s.ok('listarReembolsos', { situacao, limite: 1, deslocamento: i }).itens,
      ),
      all,
    );
  }
  const movements = s.ok('listarMovimentos', { vendaId: s.ids.integrated, limite: 200 }).itens;
  let cursor = 0;
  const paged = [];
  for (let i = 0; i < movements.length; i++) {
    const r = s.ok('listarMovimentos', { vendaId: s.ids.integrated, aposId: cursor, limite: 1 });
    paged.push(...r.itens);
    cursor = r.itens[0].id;
  }
  assert.deepEqual(paged, movements);
  assert.equal(
    s.ok('listarMovimentos', { vendaId: s.ids.integrated, aposId: cursor }).itens.length,
    0,
  );
});
test('read-only IPC rejects malformed inputs, crossed documents, excess arity and exposes no write or generic channels', async (t) => {
  const s = await setup(t),
    before = snapshot(s.db);
  for (const handler of s.handlers.values())
    for (const args of [[], [null], [undefined], [{}, {}], [{ sql: 'SELECT 1' }]])
      assert.equal(handler(...args).ok, false);
  for (const v of [
    { limite: 0 },
    { limite: 201 },
    { limite: '2' },
    { deslocamento: -1 },
    { clienteId: '1' },
    { vendaId: NaN },
    { situacao: '__proto__' },
    { vencimentoDe: '2026-02-30' },
    { vencimentoDe: '2099-01-02', vencimentoAte: '2099-01-01' },
  ])
    assert.equal(s.call('listarParcelas', v).error.code, 'VALIDATION');
  assert.equal(
    s.call('obterMovimento', { vendaId: s.ids.cash, movimentoId: s.ids.receipt }).error.code,
    'NOT_FOUND',
  );
  assert.equal(
    s.call('obterReembolso', { vendaId: s.ids.cash, reembolsoId: s.ids.active }).error.code,
    'NOT_FOUND',
  );
  assert.equal(
    s.call('obterDocumento', { vendaId: s.ids.cash, documentoId: s.ids.correction }).error.code,
    'NOT_FOUND',
  );
  const wrong = s.ok('listarParcelas', { vendaId: s.ids.cash, situacao: 'TODAS' }).itens[0];
  assert.equal(
    s.call('listarMovimentos', { vendaId: s.ids.integrated, parcelaId: wrong.id }).error.code,
    'NOT_FOUND',
  );
  assert.equal(s.call('obterVenda', s.product.id + 999999).error.code, 'NOT_FOUND');
  assert.equal(snapshot(s.db), before);
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync('dist/electron/preload/index.cjs', 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_, value) => (api = value) },
      ipcRenderer: {
        invoke: (channel, ...args) => {
          calls.push({ channel, args });
          return Promise.resolve();
        },
      },
    }),
  });
  for (const [namespace, channels] of [
    ['financeiro', CANAIS_FINANCEIRO],
    ['correcoes', CANAIS_CORRECOES],
  ]) {
    assert.deepEqual(Object.keys(api[namespace]).sort(), Object.keys(channels).sort());
    for (const [method, channel] of Object.entries(channels)) {
      await api[namespace][method]({});
      assert.deepEqual(calls.at(-1), { channel, args: [{}] });
    }
  }
  assert.equal(api.invoke, undefined);
  const registered = new Map();
  const sandbox = {
    exports: {},
    console,
    require: (name) =>
      name === 'electron'
        ? { app: { getVersion: () => 'test' }, ipcMain: { handle: (c, h) => registered.set(c, h) } }
        : require(resolve('dist/electron/ipc', name)),
  };
  vm.runInNewContext(readFileSync('dist/electron/ipc/index.js', 'utf8'), sandbox);
  const frame = { url: 'mnr://app/index.html#/financeiro' },
    window = { webContents: { mainFrame: frame } };
  sandbox.exports.registerIpc(window, s.db, 'mnr://app/index.html');
  for (const channel of s.handlers.keys()) {
    const handler = registered.get(channel);
    for (const event of [
      { sender: {}, senderFrame: frame },
      { sender: window.webContents, senderFrame: null },
      { sender: window.webContents, senderFrame: { url: frame.url } },
    ])
      assert.throws(() => handler(event, {}), /não autorizada/);
    frame.url = 'https://evil.invalid';
    assert.throws(() => handler({ sender: window.webContents, senderFrame: frame }, {}));
    frame.url = 'mnr://app/index.html';
  }
  assert.equal(snapshot(s.db), before);
});
