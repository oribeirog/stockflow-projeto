const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs');
const { seedFinanceiro, snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { createReceiptService } = require('../dist/electron/services/recebimentos');
const { createFinancialService } = require('../dist/electron/services/financeiro');

test('revisão de recebimento não grava; conflito e replay preservam os efeitos', async (t) => {
  const f = await fixture(t),
    ids = seedFinanceiro(f.db);
  const form = f.db.prepare('SELECT id FROM formas_pagamento LIMIT 1').get().id;
  f.catalog.saveReference(
    'FORMA_PAGAMENTO',
    cadastro({ id: form, nome: 'Forma atual inativa', ativo: true }),
  );
  const clock = () => new Date('2026-11-03T15:00:00Z');
  const service = createReceiptService(f.db, 'test', clock);
  const old = createFinancialService(f.db, 'test', clock);
  const dados = {
    vendaId: ids.partial,
    dataEfetiva: '2026-11-01',
    pagamentos: [{ formaPagamentoId: form, valorCentavos: 5000 }],
  };
  const before = snapshot(f.db);
  const r = service.revisarRecebimento({ motivo: 'Recebimento', dados });
  assert.equal(snapshot(f.db), before);
  assert.equal(r.plano.totalCentavos, 5000);
  old.registrarRecebimento(
    cadastro({ ...dados, pagamentos: [{ formaPagamentoId: form, valorCentavos: 1000 }] }),
  );
  const stale = { operacaoId: randomUUID(), motivo: 'Recebimento', dados, revisao: r.revisao };
  const afterOther = snapshot(f.db);
  assert.throws(
    () => service.registrarRecebimento(stale),
    (e) => e.code === 'VERSION_CONFLICT',
  );
  assert.equal(snapshot(f.db), afterOther);
  const fresh = service.revisarRecebimento({ motivo: 'Recebimento', dados });
  const command = { ...stale, revisao: fresh.revisao };
  const result = service.registrarRecebimento(command),
    after = snapshot(f.db);
  assert.deepEqual(service.registrarRecebimento(command), result);
  assert.equal(snapshot(f.db), after);
  assert.throws(
    () =>
      service.registrarRecebimento({
        ...command,
        dados: { ...dados, pagamentos: [{ formaPagamentoId: form, valorCentavos: 2000 }] },
      }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT',
  );
});
