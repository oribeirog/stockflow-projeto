const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { criarHandlersCompras } = require('../dist/electron/ipc/compras.js');
const { criarHandlersCadastros } = require('../dist/electron/ipc/cadastros.js');
const { CANAIS_COMPRAS } = require('../dist/shared/compras-ipc.js');
const { CANAIS_CADASTROS } = require('../dist/shared/cadastros-ipc.js');
const { createCommercialService } = require('../dist/electron/services/comercial.js');
function setup(f) {
  const handlers = criarHandlersCompras(f.db, 'test');
  const cadastros = criarHandlersCadastros(f.db, 'test');
  const call = (method, input) => handlers.get(CANAIS_COMPRAS[method])(input);
  const ok = (method, input) => {
    const r = call(method, input);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const form = (dados) => {
    const c = cadastro(dados);
    const r = cadastros.get(CANAIS_CADASTROS.formasPagamento.salvar)(c);
    assert.equal(r.ok, true, JSON.stringify(r));
    return { value: r.data, command: c };
  };
  const supplier = f.catalog.savePerson('FORNECEDOR', cadastro({ nome: 'Fornecedor original' }));
  const draft = (extra = {}) => ({
    fornecedorId: supplier.id,
    dataComercial: '2026-10-31',
    itens: [{ produtoId: f.product.id, quantidade: 3, valorUnitarioCentavos: 100 }],
    ...extra,
  });
  return { handlers, cadastros, call, ok, form, supplier, draft };
}
test('empty payment catalogue is never seeded; first form, full payment and idempotent purchase update stock exactly once', async (t) => {
  const f = await fixture(t),
    s = setup(f);
  assert.deepEqual(s.cadastros.get(CANAIS_CADASTROS.formasPagamento.listar)({}), {
    ok: true,
    data: [],
  });
  const save = cadastro(s.draft()),
    d = s.ok('salvarRascunho', save);
  assert.deepEqual(s.ok('salvarRascunho', save), d);
  assert.equal(
    s.call('confirmar', cadastro({ id: d.id, versaoEsperada: d.versao, pagamentos: [] })).error
      .code,
    'VALIDATION',
  );
  const { value: form, command } = s.form({ nome: 'Pix' });
  assert.deepEqual(s.cadastros.get(CANAIS_CADASTROS.formasPagamento.salvar)(command), {
    ok: true,
    data: form,
  });
  const confirm = cadastro({
    id: d.id,
    versaoEsperada: d.versao,
    pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 300 }],
  });
  const confirmed = s.ok('confirmar', confirm);
  assert.equal(confirmed.estado, 'CONFIRMADO');
  assert.deepEqual(s.ok('confirmar', confirm), confirmed);
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n, 1);
  assert.equal(
    f.db.prepare('SELECT quantidade FROM saldos_estoque WHERE produto_id=?').get(f.product.id)
      .quantidade,
    3,
  );
  s.form({ id: form.id, nome: 'Pix novo', ativo: false });
  f.catalog.savePerson(
    'FORNECEDOR',
    cadastro({ id: s.supplier.id, nome: 'Fornecedor novo', ativo: false }),
  );
  f.catalog.saveProduct(
    cadastro({ ...f.productData, id: f.product.id, nome: 'Produto novo', ativo: false }),
  );
  const detail = s.ok('obter', d.id);
  assert.equal(detail.contraparteNome, 'Fornecedor original');
  assert.equal(detail.itens[0].descricaoHistorica, 'Perfume');
  assert.equal(detail.pagamentos[0].nomeHistorico, 'Pix');
  assert.deepEqual(
    s.ok('confirmar', confirm),
    confirmed,
    'Replay precedes active reference and state checks',
  );
  assert.equal(s.call('confirmar', cadastro(confirm.dados)).error.code, 'INVALID_STATE');
  assert.equal(
    s.call('salvarRascunho', cadastro({ ...s.draft(), id: d.id, versaoEsperada: confirmed.versao }))
      .error.code,
    'INVALID_STATE',
  );
  assert.equal(f.db.pragma('user_version', { simple: true }), 5);
});
test('multiple perfumes, exact official allocations, multiple forms and moving average reuse commercial rules', async (t) => {
  const f = await fixture(t),
    s = setup(f);
  f.service.registrarEntrada(
    f.command({ produtoId: f.product.id, quantidade: 2, custoTotalCentavos: 200 }),
  );
  const p2 = f.catalog.saveProduct(cadastro({ ...f.productData, nome: 'Outro', sku: 'OUTRO' }));
  const d = s.ok(
    'salvarRascunho',
    cadastro(
      s.draft({
        itens: [
          {
            produtoId: f.product.id,
            quantidade: 3,
            valorUnitarioCentavos: 101,
            desconto: { tipo: 'PONTOS_BASE', valor: 1000 },
          },
          { produtoId: p2.id, quantidade: 1, valorUnitarioCentavos: 201 },
        ],
        descontoGlobal: { tipo: 'CENTAVOS', valor: 1 },
        freteCentavos: 5,
        despesasDiretasCentavos: 3,
      }),
    ),
  );
  assert.equal(d.subtotalCentavos, 504);
  assert.equal(d.descontoItensCentavos, 30);
  assert.equal(d.totalCentavos, 481);
  assert.deepEqual(
    d.itens.map((i) => [
      i.descontoGlobalRateadoCentavos,
      i.freteRateadoCentavos,
      i.despesasRateadasCentavos,
      i.custoAquisicaoCentavos,
    ]),
    [
      [1, 3, 2, 277],
      [0, 2, 1, 204],
    ],
  );
  const pix = s.form({ nome: 'Pix' }).value,
    cash = s.form({ nome: 'Dinheiro' }).value;
  s.ok(
    'confirmar',
    cadastro({
      id: d.id,
      versaoEsperada: d.versao,
      pagamentos: [
        { formaPagamentoId: pix.id, valorCentavos: 200 },
        { formaPagamentoId: cash.id, valorCentavos: 281 },
      ],
    }),
  );
  assert.equal(s.ok('obter', d.id).pagamentos.length, 2);
  assert.deepEqual(
    f.db
      .prepare(
        'SELECT quantidade,valor_total_centavos AS valor FROM saldos_estoque WHERE produto_id=?',
      )
      .get(f.product.id),
    { quantidade: 5, valor: 477 },
  );
  f.service.registrarSaida(f.command({ produtoId: f.product.id, quantidade: 1 }));
  assert.equal(
    f.db
      .prepare('SELECT valor_total_centavos v FROM saldos_estoque WHERE produto_id=?')
      .get(f.product.id).v,
    382,
  );
});
test('inactive forms, invalid sums and rollback preserve the draft; retry succeeds with unchanged intention', async (t) => {
  const f = await fixture(t),
    s = setup(f),
    form = s.form({ nome: 'Cartão' }).value;
  const d = s.ok('salvarRascunho', cadastro(s.draft()));
  const data = {
    id: d.id,
    versaoEsperada: d.versao,
    pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 300 }],
  };
  for (const valorCentavos of [299, 301, 0, -1, 0.1, NaN, Number.MAX_SAFE_INTEGER])
    assert.equal(
      s.call(
        'confirmar',
        cadastro({ ...data, pagamentos: [{ formaPagamentoId: form.id, valorCentavos }] }),
      ).error.code,
      'VALIDATION',
    );
  s.form({ id: form.id, nome: 'Cartão', ativo: false });
  assert.equal(s.call('confirmar', cadastro(data)).error.code, 'INACTIVE_REFERENCE');
  s.form({ id: form.id, nome: 'Cartão', ativo: true });
  const command = cadastro(data);
  const snapshot = () =>
    JSON.stringify(
      [
        'documentos',
        'itens_documento',
        'saldos_estoque',
        'movimentacoes_estoque',
        'movimentos_financeiros',
        'operacoes',
        'eventos_auditoria',
      ].map((table) => f.db.prepare('SELECT * FROM ' + table).all()),
    );
  for (const table of ['movimentacoes_estoque', 'movimentos_financeiros', 'eventos_auditoria']) {
    const before = snapshot();
    f.db.exec(
      `CREATE TRIGGER test_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'private path/SQL'); END`,
    );
    const r = s.call('confirmar', command);
    assert.equal(r.error.code, 'INTEGRITY');
    assert.doesNotMatch(r.error.message, /private|SQL/);
    assert.equal(snapshot(), before);
    f.db.exec('DROP TRIGGER test_fail');
  }
  s.ok('confirmar', command);
  s.ok('confirmar', command);
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 1);
});
test('discard preserves display snapshots, audit and idempotency without stock or payment effects', async (t) => {
  const f = await fixture(t),
    s = setup(f),
    d = s.ok('salvarRascunho', cadastro(s.draft()));
  const c = cadastro({ id: d.id, versaoEsperada: d.versao });
  const out = s.ok('descartarRascunho', c);
  assert.equal(out.estado, 'DESCARTADO');
  assert.deepEqual(s.ok('descartarRascunho', c), out);
  f.catalog.saveProduct(cadastro({ ...f.productData, id: f.product.id, nome: 'Novo' }));
  f.catalog.savePerson('FORNECEDOR', cadastro({ id: s.supplier.id, nome: 'Novo' }));
  const detail = s.ok('obter', d.id);
  assert.equal(detail.itens[0].descricaoHistorica, 'Perfume');
  assert.equal(detail.contraparteNome, 'Fornecedor original');
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n, 0);
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM eventos_auditoria WHERE evento='COMERCIAL_DESCARTAR'")
      .get().n,
    1,
  );
  assert.equal(s.call('descartarRascunho', cadastro(c.dados)).error.code, 'INVALID_STATE');
});
test('purchase boundary filters before pagination and rejects sales, generic fields, stale versions and malformed calls', async (t) => {
  const f = await fixture(t),
    s = setup(f),
    commercial = createCommercialService(f.db, 'test');
  const sale = commercial.salvarRascunho(
    cadastro({ tipo: 'VENDA', dataComercial: '2026-10-31', itens: [] }),
  );
  const first = s.ok('salvarRascunho', cadastro(s.draft()));
  const second = s.ok('salvarRascunho', cadastro(s.draft({ itens: [] })));
  s.ok('descartarRascunho', cadastro({ id: second.id, versaoEsperada: second.versao }));
  assert.equal(s.ok('listar', { limite: 1 }).itens[0].id, second.id);
  assert.equal(s.ok('listar', { limite: 1, deslocamento: 1 }).itens[0].id, first.id);
  assert.equal(s.ok('listar', { estado: 'RASCUNHO', limite: 1 }).itens[0].id, first.id);
  assert.equal(s.ok('listar', { fornecedorId: 999 }).itens.length, 0);
  for (const method of ['obter', 'salvarRascunho', 'confirmar', 'descartarRascunho']) {
    const input =
      method === 'obter'
        ? sale.id
        : cadastro(
            method === 'salvarRascunho'
              ? { ...s.draft(), id: sale.id, versaoEsperada: sale.versao }
              : { id: sale.id, versaoEsperada: sale.versao },
          );
    assert.equal(s.call(method, input).error.code, 'NOT_FOUND');
  }
  assert.equal(
    s.call('salvarRascunho', cadastro({ ...s.draft(), tipo: 'VENDA' })).error.code,
    'VALIDATION',
  );
  assert.equal(
    s.call('confirmar', cadastro({ id: first.id, versaoEsperada: first.versao, parcelas: [] }))
      .error.code,
    'VALIDATION',
  );
  const saved = s.ok(
    'salvarRascunho',
    cadastro({ ...s.draft(), id: first.id, versaoEsperada: first.versao }),
  );
  assert.equal(
    s.call('descartarRascunho', cadastro({ id: first.id, versaoEsperada: first.versao })).error
      .code,
    'VERSION_CONFLICT',
  );
  assert.equal(saved.versao, first.versao + 1);
  for (const handler of s.handlers.values())
    for (const args of [[], [undefined], [null], [{}, {}]])
      assert.equal(handler(...args).error.code, 'VALIDATION');
  for (const query of [
    { estado: 'VENDA' },
    { tipo: 'VENDA' },
    { limite: 201 },
    { deslocamento: -1 },
    { fornecedorId: '1' },
  ])
    assert.equal(s.call('listar', query).error.code, 'VALIDATION');
});
test('preload exposes exactly five fixed purchase operations with no generic invocation', async () => {
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync('dist/electron/preload/index.cjs', 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_key, value) => (api = value) },
      ipcRenderer: {
        invoke: (channel, ...args) => {
          calls.push({ channel, args });
          return Promise.resolve({ ok: true });
        },
      },
    }),
  });
  assert.deepEqual(Object.keys(api.compras).sort(), Object.keys(CANAIS_COMPRAS).sort());
  for (const [method, channel] of Object.entries(CANAIS_COMPRAS)) {
    await api.compras[method]({});
    assert.deepEqual(calls.at(-1), { channel, args: [{}] });
  }
  assert.equal(api.invoke, undefined);
  assert.equal(api.financeiro, undefined);
  assert.equal(api.vendas, undefined);
});
