const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { createCommercialService } = require('../dist/electron/services/comercial');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { criarHandlersConsultasFinanceiras } = require('../dist/electron/ipc/financeiro');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const clock = () => new Date('2026-11-04T15:00:00Z');
async function setup(t) {
  const f = await fixture(t);
  f.service.registrarEntrada(
    f.command({ produtoId: f.product.id, quantidade: 100, custoTotalCentavos: 1000 }),
  );
  const client = f.catalog.savePerson('CLIENTE', cadastro({ nome: 'Cliente recebimento' }));
  const pix = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Pix' }));
  const cash = f.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ nome: 'Dinheiro' }));
  const commercial = createCommercialService(f.db, 'test', clock);
  const sale = (entry = false) => {
    const d = commercial.salvarRascunho(
      cadastro({
        tipo: 'VENDA',
        clienteId: client.id,
        modalidadeVenda: 'A_PRAZO',
        dataComercial: '2026-10-31',
        itens: [{ produtoId: f.product.id, quantidade: 3, valorUnitarioCentavos: 10000 }],
      }),
    );
    return commercial[entry ? 'confirmarComEntrada' : 'confirmar'](
      cadastro({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: entry ? [{ formaPagamentoId: pix.id, valorCentavos: 10000 }] : [],
        parcelas: (entry
          ? ['2099-01-01', '2099-02-01']
          : ['2026-10-31', '2099-01-01', '2099-02-01']
        ).map((vencimento) => ({ vencimento, valorCentavos: 10000 })),
      }),
    );
  };
  const d = sale(),
    other = sale(),
    entry = sale(true);
  f.catalog.savePerson('CLIENTE', cadastro({ id: client.id, nome: client.nome, ativo: false }));
  const handlers = criarHandlersConsultasFinanceiras(f.db, clock, 'test-ipc');
  const call = (method, input) => handlers.get('financeiro:' + method)(input);
  const ok = (method, input) => {
    const r = call(method, input);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const data = (amount = 5000, extra = {}) => ({
    vendaId: d.id,
    dataEfetiva: '2026-11-01',
    pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: amount }],
    ...extra,
  });
  const command = (dados) => ({
    operacaoId: randomUUID(),
    motivo: 'Recebimento IPC',
    dados,
    revisao: ok('revisar-recebimento', { motivo: 'Recebimento IPC', dados }).revisao,
  });
  return { ...f, d, other, entry, pix, cash, handlers, call, ok, data, command };
}
test('IPC: partial, full, anticipated, multiple forms and manual allocation; review is strictly read-only', async (t) => {
  const s = await setup(t),
    before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  const r = s.ok('revisar-recebimento', { motivo: 'Recebimento IPC', dados: s.data() });
  s.db.pragma('query_only=OFF');
  assert.equal(snapshot(s.db), before);
  assert.equal(r.plano.alocacoes[0].parcelaId, s.d.parcelas[0].id);
  assert.equal(r.saldoPrevistoCentavos, 25000);
  assert.equal(r.efeitos[0].saldoPrevistoCentavos, 5000);
  s.ok('registrar-recebimento', s.command(s.data()));
  let ps = s.ok('listar-parcelas', { vendaId: s.d.id, situacao: 'TODAS' }).itens;
  assert.equal(ps[0].saldoCentavos, 5000);
  s.ok('registrar-recebimento', s.command(s.data(5000)));
  ps = s.ok('listar-parcelas', { vendaId: s.d.id, situacao: 'TODAS' }).itens;
  assert.equal(ps[0].status, 'QUITADO');
  const manual = s.data(20000, {
    pagamentos: [
      { formaPagamentoId: s.pix.id, valorCentavos: 7000 },
      { formaPagamentoId: s.cash.id, valorCentavos: 13000 },
    ],
    alocacoes: ps.slice(1).map((p) => ({ parcelaId: p.id, valorCentavos: 10000 })),
  });
  const preview = s.ok('revisar-recebimento', { motivo: 'Recebimento IPC', dados: manual });
  assert.equal(preview.plano.alocacoes.length, 2);
  const result = s.ok('registrar-recebimento', s.command(manual));
  assert.equal(result.movimentos.length, 2);
  assert.equal(result.financeiro.saldoReceberCentavos, 0);
  const entry = s.command(s.data(10000, { vendaId: s.entry.id }));
  s.ok('registrar-recebimento', entry);
  assert.equal(s.ok('obter-venda', s.entry.id).resumo.recebimentosEfetivosCentavos, 20000);
});
test('IPC: invalid input, dates, inactive forms and crossed allocations cause no effects; arity is strict', async (t) => {
  const s = await setup(t),
    before = snapshot(s.db);
  for (const args of [[], [null], [{}, {}]])
    for (const m of ['revisar-recebimento', 'registrar-recebimento'])
      assert.equal(s.handlers.get('financeiro:' + m)(...args).ok, false);
  for (const dados of [
    s.data(0),
    s.data(-1),
    s.data(1.1),
    s.data(30001),
    s.data(1, { vendaId: '1' }),
    s.data(1, { dataEfetiva: '2026-02-30' }),
    s.data(1, { dataEfetiva: '2026-10-30' }),
    s.data(1, { dataEfetiva: '2099-01-01' }),
    s.data(1, { extra: true }),
    s.data(1, { alocacoes: [{ parcelaId: s.other.parcelas[0].id, valorCentavos: 1 }] }),
    s.data(5, { alocacoes: [{ parcelaId: s.d.parcelas[0].id, valorCentavos: 4 }] }),
    s.data(10001, { alocacoes: [{ parcelaId: s.d.parcelas[0].id, valorCentavos: 10001 }] }),
  ])
    assert.equal(
      s.call('revisar-recebimento', { motivo: 'Teste', dados }).error.code,
      'VALIDATION',
      JSON.stringify(dados),
    );
  assert.equal(snapshot(s.db), before);
  s.catalog.saveReference('FORMA_PAGAMENTO', cadastro({ id: s.pix.id, nome: 'Pix', ativo: false }));
  const r = s.call('revisar-recebimento', { motivo: 'Teste', dados: s.data() });
  assert.equal(r.error.code, 'INACTIVE_REFERENCE');
  assert.doesNotMatch(r.error.message, /SELECT|sqlite|stack|[A-Z]:\\/);
});
test('IPC: financial conflict even after full settlement; immutable lost-reply replay survives later changes and reopening', async (t) => {
  const s = await setup(t),
    command = s.command(s.data());
  const old = createFinancialService(s.db, 'test', clock);
  old.registrarRecebimento(cadastro(s.data(30000)));
  const before = snapshot(s.db);
  assert.equal(s.call('registrar-recebimento', command).error.code, 'VERSION_CONFLICT');
  assert.equal(snapshot(s.db), before);
  const c = s.command(s.data(1000, { vendaId: s.other.id }));
  const committed = s.ok('registrar-recebimento', c); // response discarded by caller
  old.registrarRecebimento(cadastro(s.data(1000, { vendaId: s.other.id })));
  const after = snapshot(s.db);
  assert.deepEqual(s.ok('registrar-recebimento', c), committed);
  assert.equal(snapshot(s.db), after);
  assert.equal(
    s.call('registrar-recebimento', {
      ...c,
      dados: { ...c.dados, pagamentos: [{ formaPagamentoId: s.pix.id, valorCentavos: 2000 }] },
    }).error.code,
    'IDEMPOTENCY_CONFLICT',
  );
  s.db.close();
  const reopened = await openDatabase(s.directory, 'test');
  try {
    const handler = criarHandlersConsultasFinanceiras(reopened, clock).get(
      'financeiro:registrar-recebimento',
    );
    assert.deepEqual(handler(c), { ok: true, data: committed });
  } finally {
    reopened.close();
  }
});
test('IPC: injected failures roll back movements, allocations, operation and audit; same intent retries', async (t) => {
  const s = await setup(t),
    c = s.command(s.data());
  for (const table of ['movimentos_financeiros', 'alocacoes_recebimento', 'eventos_auditoria']) {
    const before = snapshot(s.db);
    s.db.exec(
      `CREATE TRIGGER receipt_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'private failure'); END`,
    );
    assert.equal(s.call('registrar-recebimento', c).error.code, 'INTEGRITY');
    assert.equal(snapshot(s.db), before);
    s.db.exec('DROP TRIGGER receipt_failure');
  }
  assert.equal(s.ok('registrar-recebimento', c).financeiro.recebimentosEfetivosCentavos, 5000);
});
