const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { criarHandlersVendas } = require('../dist/electron/ipc/vendas.js');
const { CANAIS_VENDAS } = require('../dist/shared/vendas-ipc.js');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { createFinancialService } = require('../dist/electron/services/financeiro.js');
const { createCorrectionService } = require('../dist/electron/services/correcoes.js');
function boundary(db) {
  const h = criarHandlersVendas(db, 'test');
  const call = (m, i) => h.get(CANAIS_VENDAS[m])(i);
  const ok = (m, i) => {
    const r = call(m, i);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  return { h, call, ok };
}
async function setup(t) {
  const f = await fixture(t),
    s = boundary(f.db);
  f.service.registrarEntrada(
    f.command({ produtoId: f.product.id, quantidade: 30, custoTotalCentavos: 3000 }),
  );
  const client = f.catalog.savePerson('CLIENTE', cadastro({ nome: 'Cliente original' }));
  const pix = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Pix' }));
  const cash = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Dinheiro' }));
  const draft = (extra = {}) =>
    s.ok(
      'salvarRascunho',
      cadastro({
        clienteId: client.id,
        modalidadeVenda: 'A_VISTA',
        dataComercial: '2026-10-31',
        itens: [{ produtoId: f.product.id, quantidade: 2, valorUnitarioCentavos: 200 }],
        ...extra,
      }),
    );
  const plan = (d, extra = {}) => ({
    id: d.id,
    versaoEsperada: d.versao,
    comEntrada: false,
    pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: d.totalCentavos }],
    parcelas: [],
    ...extra,
  });
  const command = (r) => {
    const { comEntrada: _, ...p } = r.plano;
    return cadastro({ ...p, revisao: r.revisao });
  };
  return { ...f, ...s, stockCommand: f.command, client, pix, cash, draft, plan, command };
}
test('sale review is read-only, division uses exact backend remainders, cash/credit/entry and replay survive reopening', async (t) => {
  const s = await setup(t);
  const snapshot = () =>
    JSON.stringify(
      [
        'operacoes',
        'eventos_auditoria',
        'documentos',
        'itens_documento',
        'movimentacoes_estoque',
        'movimentos_financeiros',
        'parcelas_receber',
        'alocacoes_recebimento',
      ].map((x) => s.db.prepare('SELECT * FROM ' + x).all()),
    );
  let last;
  for (const mode of ['cash', 'credit', 'entry']) {
    const d = s.draft({
      modalidadeVenda: mode === 'cash' ? 'A_VISTA' : 'A_PRAZO',
      descontoGlobal: { tipo: 'CENTAVOS', valor: 1 },
    });
    const p = s.plan(
      d,
      mode === 'cash'
        ? {
            pagamentos: [
              { formaPagamentoId: s.pix.id, valorCentavos: 199 },
              { formaPagamentoId: s.cash.id, valorCentavos: 200 },
            ],
          }
        : {
            comEntrada: mode === 'entry',
            pagamentos:
              mode === 'entry' ? [{ formaPagamentoId: s.pix.id, valorCentavos: 100 }] : [],
            dividir: { vencimentos: ['2026-11-10', '2026-12-10'] },
          },
    );
    const before = snapshot(),
      r = s.ok('revisarPlano', p);
    assert.equal(snapshot(), before, 'review must not persist anything');
    assert.equal(r.saldoFuturoCentavos, mode === 'cash' ? 0 : mode === 'entry' ? 299 : 399);
    if (mode !== 'cash')
      assert.deepEqual(
        r.plano.parcelas.map((x) => x.valorCentavos),
        mode === 'entry' ? [150, 149] : [200, 199],
      );
    const c = s.command(r),
      method = mode === 'entry' ? 'confirmarComEntrada' : 'confirmar';
    const out = s.ok(method, c),
      after = snapshot();
    assert.deepEqual(s.ok(method, c), out);
    assert.equal(snapshot(), after);
    assert.equal(
      out.recebidoConfirmacaoCentavos,
      mode === 'cash' ? 399 : mode === 'entry' ? 100 : 0,
    );
    assert.equal(out.financeiro.saldoReceberCentavos, r.saldoFuturoCentavos);
    if (mode === 'entry') {
      assert.equal(out.parcelasFinanceiras[0].tipo, 'ENTRADA');
      assert.equal(out.parcelasFinanceiras[0].saldoCentavos, 0);
    }
    last = { method, c, out };
  }
  s.db.close();
  const db = await openDatabase(s.directory, 'test');
  t.after(() => db.close());
  assert.deepEqual(boundary(db).ok(last.method, last.c), last.out);
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
test('sale confirmation revalidates stock, cost, version, active forms, reviewed plan and rolls back all effects', async (t) => {
  const s = await setup(t),
    d = s.draft(),
    r = s.ok('revisarPlano', s.plan(d)),
    c = s.command(r);
  assert.equal(
    s.call('confirmar', { ...c, dados: { ...c.dados, pagamentos: [] } }).error.code,
    'VALIDATION',
  );
  s.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ id: s.pix.id, nome: 'Pix', ativo: false }));
  assert.equal(s.call('confirmar', c).error.code, 'INACTIVE_REFERENCE');
  s.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ id: s.pix.id, nome: 'Pix', ativo: true }));
  const snapshot = () =>
    JSON.stringify(
      [
        'documentos',
        'itens_documento',
        'saldos_estoque',
        'movimentacoes_estoque',
        'parcelas_receber',
        'movimentos_financeiros',
        'alocacoes_recebimento',
        'operacoes',
        'eventos_auditoria',
      ].map((x) => s.db.prepare('SELECT * FROM ' + x).all()),
    );
  for (const table of [
    'movimentacoes_estoque',
    'parcelas_receber',
    'movimentos_financeiros',
    'alocacoes_recebimento',
    'eventos_auditoria',
  ]) {
    const before = snapshot();
    s.db.exec(
      `CREATE TRIGGER test_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'private SQL'); END`,
    );
    assert.equal(s.call('confirmar', c).error.code, 'INTEGRITY');
    assert.equal(snapshot(), before);
    s.db.exec('DROP TRIGGER test_failure');
  }
  s.service.registrarSaida(s.stockCommand({ produtoId: s.product.id, quantidade: 29 }));
  assert.equal(s.call('confirmar', c).error.code, 'INSUFFICIENT_STOCK');
  s.service.registrarEntrada(
    s.stockCommand({ produtoId: s.product.id, quantidade: 2, custoTotalCentavos: 900 }),
  );
  assert.equal(s.call('confirmar', c).error.code, 'BELOW_COST');
  const newer = s.draft({
    id: d.id,
    versaoEsperada: d.versao,
    itens: [
      {
        produtoId: s.product.id,
        quantidade: 2,
        valorUnitarioCentavos: 200,
        motivo: 'Venda promocional',
      },
    ],
  });
  assert.equal(s.call('confirmar', c).error.code, 'VERSION_CONFLICT');
  s.ok('confirmar', s.command(s.ok('revisarPlano', s.plan(newer))));
});

test('historical sale projection uses financial summary after receipts/corrections and preserves snapshots', async (t) => {
  const s = await setup(t),
    d = s.draft({ modalidadeVenda: 'A_PRAZO' });
  const r = s.ok(
    'revisarPlano',
    s.plan(d, { pagamentos: [], parcelas: [{ valorCentavos: 400, vencimento: '2026-12-10' }] }),
  );
  s.ok('confirmar', s.command(r));
  const fin = createFinancialService(s.db, 'test');
  fin.registrarRecebimento(
    cadastro({
      vendaId: d.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: s.pix.id, valorCentavos: 300 }],
    }),
  );
  createCorrectionService(s.db, 'test').devolverVenda(
    cadastro({
      documentoId: d.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: s.ok('obter', d.id).itens[0].id, quantidade: 1, quantidadePerda: 1 }],
    }),
  );
  s.catalog.saveProduct(
    cadastro({ ...s.productData, id: s.product.id, nome: 'Nome novo', ativo: false }),
  );
  s.catalog.savePerson(
    'CLIENTE',
    cadastro({ id: s.client.id, nome: 'Cliente novo', ativo: false }),
  );
  const out = s.ok('obter', d.id);
  assert.equal(out.contraparteNome, 'Cliente original');
  assert.equal(out.itens[0].descricaoHistorica, 'Perfume');
  assert.equal(out.recebidoConfirmacaoCentavos, 0);
  assert.equal(out.financeiro.recebimentosEfetivosCentavos, 300);
  assert.equal(out.financeiro.saldoReceberCentavos, 0);
  assert.equal(out.financeiro.reembolsosPendentesCentavos, 100);
});

test('sale boundary rejects malformed calls and cross-document IDs; preload has only fixed sales channels', async (t) => {
  const s = await setup(t);
  const { createCommercialService } = require('../dist/electron/services/comercial.js');
  const purchase = createCommercialService(s.db, 'test').salvarRascunho(
    cadastro({ tipo: 'COMPRA', dataComercial: '2026-10-31', itens: [] }),
  );
  assert.equal(s.call('obter', purchase.id).error.code, 'NOT_FOUND');
  assert.equal(
    s.call('descartarRascunho', cadastro({ id: purchase.id, versaoEsperada: purchase.versao }))
      .error.code,
    'NOT_FOUND',
  );
  const draft = s.draft();
  const discard = cadastro({ id: draft.id, versaoEsperada: draft.versao });
  assert.equal(s.ok('descartarRascunho', discard).estado, 'DESCARTADO');
  assert.equal(s.ok('descartarRascunho', discard).estado, 'DESCARTADO');
  assert.equal(s.ok('listar', { estado: 'DESCARTADO', limite: 1 }).itens[0].id, draft.id);
  assert.equal(
    s.ok('listar', {}).itens.some((d) => d.id === purchase.id),
    false,
  );
  for (const h of s.h.values())
    for (const args of [[], [null], [undefined], [{}, {}]])
      assert.equal(h(...args).error.code, 'VALIDATION');
  for (const q of [
    { tipo: 'VENDA' },
    { estado: 'VENDA' },
    { limite: 201 },
    { clienteId: '1' },
    { deslocamento: -1 },
  ])
    assert.equal(s.call('listar', q).error.code, 'VALIDATION');
  assert.equal(s.call('salvarRascunho', cadastro({ tipo: 'COMPRA' })).error.code, 'VALIDATION');
  const vm = require('node:vm'),
    fs = require('node:fs');
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync('dist/electron/preload/index.cjs', 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_, value) => (api = value) },
      ipcRenderer: {
        invoke: (channel, input) => {
          calls.push([channel, input]);
          return Promise.resolve();
        },
      },
    }),
  });
  assert.deepEqual(Object.keys(api.vendas).sort(), Object.keys(CANAIS_VENDAS).sort());
  for (const [method, channel] of Object.entries(CANAIS_VENDAS)) {
    await api.vendas[method](1);
    assert.deepEqual(calls.at(-1), [channel, 1]);
  }
  assert.ok(api.financeiro);
  assert.ok(api.correcoes);
  assert.equal(typeof api.financeiro.registrarRecebimento, 'function');
  assert.equal(api.correcoes.estornarDevolucao, undefined);
  assert.equal(api.invoke, undefined);
});
