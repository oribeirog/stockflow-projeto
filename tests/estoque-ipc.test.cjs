const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, cadastro, command } = require('./helpers/estoque-fixture.cjs');
const { criarHandlersEstoque, erroEstoque } = require('../dist/electron/ipc/estoque.js');
const { CANAIS_ESTOQUE, MENSAGENS_ESTOQUE } = require('../dist/shared/estoque-ipc.js');
function setup(f) {
  const handlers = criarHandlersEstoque(f.db, 'test');
  const invoke = (method, ...args) => handlers.get(CANAIS_ESTOQUE[method])(...args);
  const ok = (method, input) => {
    const r = invoke(method, input);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  return { handlers, invoke, ok };
}
test('stock read side filters before paging, exact averages, totals and immutable movement history', async (t) => {
  const f = await fixture(t),
    { ok } = setup(f);
  f.catalog.saveProduct(
    cadastro({ ...f.productData, id: f.product.id, nome: 'Água Perfume', estoqueMinimo: 3 }),
  );
  const entrada = command({ produtoId: f.product.id, quantidade: 3, custoTotalCentavos: 100 });
  const before = ok('registrarEntrada', entrada);
  let p = ok('obter', f.product.id);
  assert.equal(p.custoMedioDecimal, '0,33');
  assert.equal(p.baixo, false);
  assert.equal(ok('listar', { busca: 'agua', somenteBaixo: true }).itens.length, 0);
  ok('registrarSaida', command({ produtoId: p.produtoId, quantidade: 1 }));
  p = ok('obter', p.produtoId);
  assert.equal(p.custoMedioDecimal, '0,34');
  assert.equal(p.baixo, true);
  const filtered = ok('listar', { busca: 'AGUA', somenteBaixo: true, limite: 1 });
  assert.equal(filtered.valorTotalFiltradoCentavos, '67');
  assert.equal(filtered.itens.length, 1);
  const first = ok('listarMovimentacoes', { produtoId: p.produtoId, limite: 1 });
  assert.equal(first.temMais, true);
  assert.equal(first.itens[0].valorAposCentavos, 100);
  const second = ok('listarMovimentacoes', {
    produtoId: p.produtoId,
    aposId: first.proximoId,
    limite: 1,
  });
  assert.equal(second.temMais, false);
  assert.equal(second.itens[0].valorDeltaCentavos, -33);
  assert.deepEqual(
    ok('registrarEntrada', entrada),
    before,
    'Lost response retry returns original result',
  );
  assert.equal(
    ok('obter', p.produtoId).quantidade,
    2,
    'Read returns current state, not idempotent snapshot',
  );
  f.catalog.saveProduct(cadastro({ ...f.productData, id: p.produtoId, ativo: false }));
  assert.equal(ok('listar', { ativo: true }).itens.length, 0);
  assert.equal(ok('listar', { ativo: false }).itens.length, 1);
  assert.equal(ok('obter', p.produtoId).ativo, false);
  ok('registrarPerda', command({ produtoId: p.produtoId, quantidade: 2 }));
  assert.equal(ok('obter', p.produtoId).custoMedioDecimal, null);
});
test('count without difference audits only; stale versions, shortages and rollback never leave partial writes', async (t) => {
  const f = await fixture(t),
    { ok, invoke } = setup(f),
    produtoId = f.product.id;
  ok('registrarEntrada', command({ produtoId, quantidade: 3, custoTotalCentavos: 100 }));
  const count = command({ produtoId, quantidadeContada: 3, versaoEsperada: 1 });
  const audit = f.db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n;
  assert.equal(ok('registrarContagem', count).movimentacaoId, null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n, audit + 1);
  assert.equal(ok('listarMovimentacoes', { produtoId }).itens.length, 1);
  ok('registrarContagem', count);
  assert.equal(f.db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n, audit + 1);
  assert.equal(
    invoke(
      'registrarContagem',
      command({ produtoId, quantidadeContada: 4, versaoEsperada: 0, custoTotalCentavos: 50 }),
    ).error.code,
    'VERSION_CONFLICT',
  );
  assert.equal(
    invoke('registrarPerda', command({ produtoId, quantidade: 4 })).error.code,
    'INSUFFICIENT_STOCK',
  );
  ok(
    'registrarContagem',
    command({ produtoId, quantidadeContada: 4, versaoEsperada: 1, custoTotalCentavos: 50 }),
  );
  ok('registrarContagem', command({ produtoId, quantidadeContada: 2, versaoEsperada: 2 }));
  assert.equal(ok('listarMovimentacoes', { produtoId }).itens[1].contagem, true);
  const snapshot = () =>
    JSON.stringify(
      ['operacoes', 'eventos_auditoria', 'movimentacoes_estoque', 'saldos_estoque'].map((table) =>
        f.db.prepare('SELECT * FROM ' + table).all(),
      ),
    );
  const before = snapshot();
  const failCommand = command({ produtoId, quantidade: 1, custoTotalCentavos: 7 });
  f.db.exec(
    "CREATE TRIGGER test_stock_audit BEFORE INSERT ON eventos_auditoria BEGIN SELECT RAISE(ABORT,'private SQL/path'); END",
  );
  assert.equal(invoke('registrarEntrada', failCommand).error.code, 'INTEGRITY');
  assert.equal(snapshot(), before);
  f.db.exec('DROP TRIGGER test_stock_audit');
  ok('registrarEntrada', failCommand);
  assert.equal(ok('obter', produtoId).quantidade, 3);
});
test('seven explicit stock handlers reject invalid IPC payloads and sanitize every error', async (t) => {
  const f = await fixture(t),
    { handlers, invoke } = setup(f);
  assert.equal(handlers.size, 7);
  for (const method of Object.keys(CANAIS_ESTOQUE))
    for (const args of [[], [undefined], [null], [{}, {}]]) {
      const r = invoke(method, ...args);
      assert.equal(r.ok, false);
      assert.equal(r.error.code, 'VALIDATION');
    }
  for (const query of [
    { limite: 201 },
    { deslocamento: -1 },
    { busca: 'x'.repeat(201) },
    { ativo: 'true' },
    { somenteBaixo: 1 },
    { sql: 'SELECT 1' },
  ])
    assert.equal(invoke('listar', query).error.code, 'VALIDATION');
  for (const id of [0, -1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(invoke('obter', id).error.code, 'VALIDATION');
  for (const method of [
    'registrarEntrada',
    'registrarSaida',
    'registrarPerda',
    'registrarContagem',
  ]) {
    assert.equal(
      invoke(method, command({ produtoId: f.product.id, quantidade: 1, movimentacaoOrigemId: 1 }))
        .error.code,
      'VALIDATION',
    );
    assert.equal(
      invoke(method, { ...command({ produtoId: f.product.id, quantidade: 1 }), sql: 'select' })
        .error.code,
      'VALIDATION',
    );
  }
  for (const error of [
    new Error('SELECT secret C:/private.db'),
    { code: 'SQLITE_CORRUPT', message: 'private' },
    null,
  ]) {
    const r = erroEstoque(error);
    assert.equal(r.error.message, MENSAGENS_ESTOQUE[r.error.code]);
    assert.doesNotMatch(r.error.message, /SELECT|private|\.db/);
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 0);
});
test('aggregate stock value remains exact above Number.MAX_SAFE_INTEGER without schema changes', async (t) => {
  const f = await fixture(t),
    { ok } = setup(f);
  f.db.transaction(() => {
    for (let i = 0; i < 1002; i++) {
      const p = f.catalog.saveProduct(
        cadastro({ ...f.productData, sku: 'BIG-' + i, nome: 'Aggregate ' + i }),
      );
      f.service.registrarEntrada(
        command({ produtoId: p.id, quantidade: 1, custoTotalCentavos: 9_000_000_000_000 }),
      );
    }
  })();
  const result = ok('listar', { busca: 'Aggregate', limite: 1 });
  assert.equal(result.valorTotalFiltradoCentavos, (1002n * 9_000_000_000_000n).toString());
  assert(BigInt(result.valorTotalFiltradoCentavos) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(result.itens.length, 1);
  assert.equal(result.temMais, true);
  assert.equal(f.db.pragma('user_version', { simple: true }), 5);
});
test('preload exposes only seven stock operations and invokes fixed channels', async () => {
  const vm = require('node:vm'),
    { readFileSync } = require('node:fs');
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync('dist/electron/preload/index.cjs', 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (_key, value) => (api = value) },
        ipcRenderer: {
          invoke: (channel, ...args) => {
            calls.push({ channel, args });
            return Promise.resolve({ ok: true });
          },
        },
      };
    },
  });
  assert.deepEqual(Object.keys(api.estoque).sort(), Object.keys(CANAIS_ESTOQUE).sort());
  assert.equal(api.compras, undefined);
  for (const [method, channel] of Object.entries(CANAIS_ESTOQUE)) {
    const input = method === 'obter' ? 1 : {};
    await api.estoque[method](input);
    assert.deepEqual(calls.at(-1), { channel, args: [input] });
  }
});
