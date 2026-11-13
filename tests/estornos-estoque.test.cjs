const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { criarHandlersEstornosEstoque } = require('../dist/electron/ipc/estornos-estoque');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedComprasCorrecoes, cmd } = require('./helpers/correcoes-compras-fixture.cjs');
const clock = () => new Date('2026-11-12T15:00:00Z');
async function setup(t) {
  const f = await fixture(t),
    handlers = criarHandlersEstornosEstoque(f.db, 'test', clock);
  const call = (method, ...args) => handlers.get('estornos-estoque:' + method)(...args);
  const ok = (m, ...args) => {
    const r = call(m, ...args);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const entry = (q = 10, v = 1000) =>
    f.service.registrarEntrada(
      f.command({ produtoId: f.product.id, quantidade: q, custoTotalCentavos: v }),
    );
  const ref = (m) => ({ produtoId: f.product.id, movimentoId: m.movimentacaoId });
  const data = (m) => ({ ...ref(m), dataEfetiva: '2026-11-01' });
  const envelope = (m) => {
    const dados = data(m),
      motivo = 'Teste isolado de estorno';
    return {
      operacaoId: randomUUID(),
      dados,
      motivo,
      revisao: ok('revisar', { motivo, dados }).revisao,
    };
  };
  return { ...f, handlers, call, ok, entry, ref, data, stockCommand: f.command, command: envelope };
}
test('4G2: positive reversal query_only; exact history, renamed inactive product and immutable snapshots', async (t) => {
  const s = await setup(t);
  s.entry();
  const adjustment = s.entry(5, 155),
    original = s.db
      .prepare('SELECT * FROM movimentacoes_estoque WHERE id=?')
      .get(adjustment.movimentacaoId);
  s.catalog.saveProduct(
    cadastro({ ...s.productData, id: s.product.id, nome: 'Nome atual diferente', ativo: false }),
  );
  const before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  const detail = s.ok('obter-ajuste', s.ref(adjustment)),
    r = s.ok('revisar', { motivo: 'Consulta', dados: s.data(adjustment) });
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
  assert.equal(detail.produto.nome, 'Nome atual diferente');
  assert.equal(detail.produto.ativo, false);
  assert.equal(r.quantidadeDelta, -5);
  assert.equal(r.valorDeltaCentavos, -155);
  assert.equal(r.quantidadeApos, 10);
  assert.equal(r.valorAposCentavos, 1000);
  const result = s.ok('estornar', s.command(adjustment));
  assert.equal(result.saldo.quantidade, 10);
  assert.equal(result.saldo.valorTotalCentavos, 1000);
  const after = s.ok('obter-ajuste', s.ref(adjustment));
  assert.equal(after.elegivel, false);
  assert.equal(after.estorno.origemId, original.id);
  assert.equal(after.estorno.valorDeltaCentavos, -155);
  assert.deepEqual(
    s.db.prepare('SELECT * FROM movimentacoes_estoque WHERE id=?').get(original.id),
    original,
  );
  assert.equal(s.db.prepare('SELECT count(*) n FROM documentos').get().n, 0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n, 0);
});
test('4G2: negative/loss/count reversals restore exact historical cents and zero-difference count has no movement', async (t) => {
  const s = await setup(t);
  s.entry(3, 100);
  for (const method of ['registrarSaida', 'registrarPerda']) {
    const before = s.service.consultarSaldo(s.product.id),
      m = s.service[method](s.stockCommand({ produtoId: s.product.id, quantidade: 1 }));
    const r = s.ok('revisar', { motivo: 'Consulta', dados: s.data(m) });
    assert.equal(r.valorDeltaCentavos, 33);
    assert.equal(r.quantidadeDelta, 1);
    s.ok('estornar', s.command(m));
    assert.equal(
      s.service.consultarSaldo(s.product.id).valorTotalCentavos,
      before.valorTotalCentavos,
    );
  }
  const m = s.service.registrarContagem(
    s.stockCommand({
      produtoId: s.product.id,
      quantidadeContada: 0,
      versaoEsperada: s.service.consultarSaldo(s.product.id).versao,
    }),
  );
  assert.equal(s.ok('obter-ajuste', s.ref(m)).original.contagem, true);
  s.ok('estornar', s.command(m));
  assert.equal(s.service.consultarSaldo(s.product.id).quantidade, 3);
  assert.equal(s.service.consultarSaldo(s.product.id).valorTotalCentavos, 100);
  const no = s.service.registrarContagem(
    s.stockCommand({
      produtoId: s.product.id,
      quantidadeContada: 3,
      versaoEsperada: s.service.consultarSaldo(s.product.id).versao,
    }),
  );
  assert.equal(no.movimentacaoId, null);
  const surplus = s.service.registrarContagem(
    s.stockCommand({
      produtoId: s.product.id,
      quantidadeContada: 5,
      versaoEsperada: no.saldo.versao,
      custoTotalCentavos: 1,
    }),
  );
  s.ok('estornar', s.command(surplus));
  assert.equal(s.service.consultarSaldo(s.product.id).valorTotalCentavos, 100);
});
test('4G2: depletion and zero-valued input reversal leave exact zero quantity/value', async (t) => {
  const s = await setup(t),
    m = s.entry(3, 1);
  s.ok('estornar', s.command(m));
  assert.equal(s.service.consultarSaldo(s.product.id).valorTotalCentavos, 0);
  assert.equal(s.service.consultarSaldo(s.product.id).quantidade, 0);
  const z = s.entry(5, 0);
  s.ok('estornar', s.command(z));
  assert.equal(s.service.consultarSaldo(s.product.id).quantidade, 0);
});
test('4G2: released SQL and service forbid later same-product movements, including compatible physical balance', async (t) => {
  for (const consumed of [8, 13]) {
    const s = await setup(t);
    s.entry(10, 1000);
    const m = s.entry(5, 500);
    s.service.registrarSaida(s.stockCommand({ produtoId: s.product.id, quantidade: consumed }));
    const before = snapshot(s.db),
      d = s.ok('obter-ajuste', s.ref(m));
    assert.equal(d.produto.quantidade, 15 - consumed);
    assert.equal(d.elegivel, false);
    assert.match(d.impedimento, /posterior/);
    assert.equal(
      s.call('revisar', { motivo: 'Teste', dados: s.data(m) }).error.code,
      'INVALID_STATE',
    );
    assert.equal(snapshot(s.db), before);
  }
  const s = await setup(t);
  s.entry(20, 2000);
  const out = s.service.registrarSaida(s.stockCommand({ produtoId: s.product.id, quantidade: 4 }));
  s.entry(1, 900);
  assert.equal(s.ok('obter-ajuste', s.ref(out)).elegivel, false);
  // An unrelated product does not invalidate this product's reversal.
  const last = s.entry(1, 1),
    other = s.catalog.saveProduct(cadastro({ ...s.productData, sku: 'OTHER' }));
  s.service.registrarEntrada(
    s.stockCommand({ produtoId: other.id, quantidade: 2, custoTotalCentavos: 10 }),
  );
  assert.equal(s.ok('obter-ajuste', s.ref(last)).elegivel, true);
  s.ok('estornar', s.command(last));
});
test('4G2: commercial sources, crossed products, unknown fields, quantities, dates, UUID and hash never write', async (t) => {
  const s = await setup(t),
    m = s.entry(),
    c = s.command(m),
    before = snapshot(s.db);
  for (const [, h] of s.handlers)
    for (const args of [[], [null], [{}, {}]]) assert.equal(h(...args).ok, false);
  for (const dados of [
    { ...c.dados, movimentoId: 999999 },
    { ...c.dados, produtoId: 999999 },
    { ...c.dados, quantidade: 1 },
    { ...c.dados, sql: 'SELECT 1' },
    { ...c.dados, path: 'C:/x' },
    ...['2026-02-30', '2099-01-01', '2026-10-30'].map((dataEfetiva) => ({
      ...c.dados,
      dataEfetiva,
    })),
  ])
    assert.equal(s.call('revisar', { dados, motivo: 'Teste' }).ok, false);
  for (const patch of [{ operacaoId: 'x' }, { revisao: 'bad' }, { motivo: '' }, { extra: true }])
    assert.equal(s.call('estornar', { ...c, ...patch }).ok, false);
  assert.equal(snapshot(s.db), before);
  const p = seedComprasCorrecoes(s.db),
    buy = p.purchase(),
    source = s.db
      .prepare(
        'SELECT m.id FROM movimentacoes_estoque m JOIN vinculos_estoque_comercial v ON v.movimentacao_id=m.id JOIN itens_documento i ON i.id=v.item_documento_id WHERE i.documento_id=?',
      )
      .get(buy.id);
  assert.equal(
    s.call('obter-ajuste', { produtoId: p.product.id, movimentoId: source.id }).error.code,
    'INVALID_STATE',
  );
});
test('4G2: optimistic review, persisted legacy replay after further changes, UUID conflict and reopen', async (t) => {
  const s = await setup(t),
    m = s.entry(),
    command = s.command(m);
  s.entry(1, 2);
  assert.equal(s.call('estornar', command).error.code, 'VERSION_CONFLICT');
  const n = s.entry(2, 3),
    fresh = s.command(n),
    core = createCorrectionService(s.db, 'test', clock),
    r = core.estornarAjuste({
      operacaoId: fresh.operacaoId,
      motivo: fresh.motivo,
      dados: { movimentoId: n.movimentacaoId, dataEfetiva: fresh.dados.dataEfetiva },
    });
  s.entry(1, 8);
  const before = snapshot(s.db);
  assert.deepEqual(s.ok('estornar', fresh), r);
  assert.equal(snapshot(s.db), before);
  assert.equal(
    s.call('estornar', { ...fresh, motivo: 'Outro' }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  s.db.close();
  const db = await openDatabase(s.directory, 'test');
  try {
    const h = criarHandlersEstornosEstoque(db, 'test', clock);
    assert.deepEqual(h.get('estornos-estoque:estornar')(fresh).data, r);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
test('4G2: failures at inverse/link/balance/audit/idempotent finalization rollback complete tables', async (t) => {
  for (const target of ['inverse', 'link', 'balance', 'audit', 'result']) {
    const s = await setup(t),
      m = s.entry(),
      c = s.command(m),
      before = snapshot(s.db);
    const sql = {
      inverse: "BEFORE INSERT ON movimentacoes_estoque WHEN NEW.natureza='REVERSAO_SAIDA'",
      link: 'AFTER INSERT ON movimentacoes_estoque WHEN NEW.movimentacao_origem_id IS NOT NULL',
      balance: 'AFTER UPDATE ON saldos_estoque',
      audit: 'BEFORE INSERT ON eventos_auditoria',
      result:
        "BEFORE UPDATE OF resultado_json ON operacoes WHEN NEW.tipo='CORRECAO_ESTORNAR_AJUSTE'",
    }[target];
    s.db.exec(
      `CREATE TRIGGER injected_stock_reversal ${sql} BEGIN SELECT RAISE(ABORT,'internal secret SQL/path'); END`,
    );
    const r = s.call('estornar', c);
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.error.message, /secret|SQL|path/);
    assert.equal(snapshot(s.db), before);
    s.db.exec('DROP TRIGGER injected_stock_reversal');
    s.ok('estornar', c);
    assert.equal(s.db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(s.db.pragma('foreign_key_check'), []);
  }
});
test('4G2: independent connections serialize stale revisions and same-UUID replay', async (t) => {
  const { Worker } = require('node:worker_threads'),
    { resolve } = require('node:path');
  async function race(s, jobs) {
    const gate = new SharedArrayBuffer(4),
      workers = jobs.map(
        (command) =>
          new Worker(resolve('tests/helpers/estornos-estoque-worker.cjs'), {
            workerData: { directory: s.directory, gate, command },
          }),
      );
    try {
      await Promise.all(
        workers.map(
          (w) =>
            new Promise((r, j) => {
              w.once('message', (m) => (m.ready ? r() : j(Error('not ready'))));
              w.once('error', j);
            }),
        ),
      );
      const results = workers.map(
        (w) =>
          new Promise((r, j) => {
            w.once('message', r);
            w.once('error', j);
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
    m = s.entry(),
    c = s.command(m),
    results = await race(s, [c, { ...c, operacaoId: randomUUID() }]);
  assert.equal(results.filter((r) => r.result).length, 1);
  assert.equal(results.filter((r) => r.code === 'VERSION_CONFLICT').length, 1);
  const n = s.entry(3, 3),
    next = s.command(n),
    same = await race(s, [next, next]);
  assert.ok(same.every((r) => r.result));
  assert.deepEqual(same[0], same[1]);
  assert.equal(
    s.db
      .prepare(
        "SELECT count(*) n FROM movimentacoes_estoque WHERE movimentacao_origem_id=? AND natureza='REVERSAO_SAIDA'",
      )
      .get(n.movimentacaoId).n,
    1,
  );
});
test('4G2: actual purchase/sale after a negative adjustment blocks reversal and preserves sales historical cost/money', async (t) => {
  for (const mode of ['compra', 'venda']) {
    const f = await setup(t),
      s = seedComprasCorrecoes(f.db);
    s.purchase(20, 2000);
    const m = f.service.registrarSaida(f.stockCommand({ produtoId: s.product.id, quantidade: 4 }));
    let sale;
    if (mode === 'compra') s.purchase(3, 4000);
    else sale = s.sale(2);
    const before = snapshot(f.db),
      d = f.ok('obter-ajuste', { produtoId: s.product.id, movimentoId: m.movimentacaoId });
    assert.equal(d.elegivel, false);
    assert.equal(
      f.call('revisar', {
        motivo: 'Não recalcular histórico',
        dados: {
          produtoId: s.product.id,
          movimentoId: m.movimentacaoId,
          dataEfetiva: '2026-11-12',
        },
      }).error.code,
      'INVALID_STATE',
    );
    assert.equal(snapshot(f.db), before);
    if (sale)
      assert.equal(
        f.db
          .prepare(
            'SELECT valor_custo_estoque_centavos v FROM itens_documento WHERE documento_id=?',
          )
          .get(sale.id).v,
        4000,
      );
  }
});
test('4G2: renamed context invalidates review, and a restored adjustment cannot create a new reversal', async (t) => {
  const s = await setup(t),
    m = s.entry(),
    old = s.command(m);
  s.catalog.saveProduct(cadastro({ ...s.productData, id: s.product.id, nome: 'Nome alterado' }));
  assert.equal(s.call('estornar', old).error.code, 'VERSION_CONFLICT');
  const c = s.command(m);
  s.ok('estornar', c);
  const before = snapshot(s.db);
  assert.equal(
    s.call('estornar', { ...c, operacaoId: randomUUID() }).error.code,
    'VERSION_CONFLICT',
  );
  assert.equal(s.call('revisar', { dados: c.dados, motivo: c.motivo }).error.code, 'INVALID_STATE');
  assert.equal(snapshot(s.db), before);
});
