const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const { cycle, command, day } = require('./helpers/consolidacao-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { reconciliarFinanceiro } = require('../dist/electron/services/financeiro-reconciliation');
const { reconciliarEstoque } = require('../dist/electron/services/estoque-reconciliation');
const receive = (s, vendaId, valorCentavos) =>
  s.execute('financeiro:revisar-recebimento', 'financeiro:registrar-recebimento', {
    vendaId,
    dataEfetiva: day,
    pagamentos: [{ formaPagamentoId: s.pix, valorCentavos }],
  });
const balance = (s) =>
  s.db
    .prepare('SELECT quantidade,valor_total_centavos FROM saldos_estoque WHERE produto_id=?')
    .get(s.productId);
test('4E2E: purchase-funded cash, credit, entry; allocation is not additional cash; reopen preserves all tables', async (t) => {
  const f = await fixture(t),
    s = cycle(f.db);
  s.buy(20, 100);
  const cash = s.sell('cash'),
    credit = s.sell('credit'),
    entry = s.sell();
  assert.deepEqual(balance(s), { quantidade: 11, valor_total_centavos: 1100 });
  assert.equal(s.q.obterVenda(cash.id).resumo.recebidoLiquidoCentavos, 30000);
  assert.equal(s.q.obterVenda(cash.id).resumo.saldoReceberCentavos, 0);
  assert.equal(s.q.obterVenda(credit.id).resumo.recebidoLiquidoCentavos, 0);
  receive(s, credit.id, 5000);
  assert.equal(s.q.obterVenda(credit.id).resumo.saldoReceberCentavos, 25000);
  receive(s, credit.id, 25000);
  assert.equal(s.q.obterVenda(credit.id).resumo.recebidoLiquidoCentavos, 30000);
  assert.equal(s.q.obterVenda(credit.id).resumo.saldoReceberCentavos, 0);
  const initial = s.q.listarParcelas({ vendaId: entry.id, situacao: 'TODAS' }).itens;
  assert.equal(initial.filter((p) => p.tipo === 'ENTRADA').length, 1);
  assert.equal(initial.find((p) => p.tipo === 'ENTRADA').saldoCentavos, 0);
  receive(s, entry.id, 15000);
  assert.equal(s.q.obterVenda(entry.id).resumo.recebidoLiquidoCentavos, 25000);
  receive(s, entry.id, 5000);
  assert.equal(s.q.obterVenda(entry.id).resumo.recebidoLiquidoCentavos, 30000);
  assert.equal(s.q.obterVenda(entry.id).resumo.saldoReceberCentavos, 0);
  assert.equal(reconciliarFinanceiro(s.db), true);
  assert.equal(reconciliarEstoque(s.db).consistente, true);
  const before = snapshot(s.db);
  s.db.close();
  const reopened = await openDatabase(f.directory, 'test');
  try {
    assert.equal(snapshot(reopened), before);
  } finally {
    reopened.close();
  }
});
test('4E2E: entire 300/250/200/150 chain; historical purchase cost, paired loss, individual refunds and final annulment', async (t) => {
  const f = await fixture(t),
    s = cycle(f.db);
  s.buy(20, 100);
  const sale = s.sell();
  receive(s, sale.id, 15000);
  assert.equal(s.q.obterVenda(sale.id).resumo.saldoReceberCentavos, 5000);
  s.buy(5, 10000); // Current average now differs from the original sale's R$1 unit cost.
  const beforeStock = balance(s);
  s.cat.saveProduct(
    command({ ...s.productData, id: s.productId, nome: 'Nome atual inativo', ativo: false }),
  );
  s.cat.savePerson(
    'CLIENTE',
    command({ id: s.clienteId, nome: 'Cliente atual inativo', ativo: false }),
  );
  const data = {
    documentoId: sale.id,
    dataEfetiva: day,
    itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
  };
  const intent = s.intention('correcoes:revisar-devolucao-venda', data);
  const before = snapshot(s.db);
  s.db.pragma('query_only=ON');
  s.call('correcoes:revisar-devolucao-venda', { motivo: intent.motivo, dados: data });
  assert.equal(snapshot(s.db), before);
  s.db.pragma('query_only=OFF');
  const returned = s.call('correcoes:devolver-venda', intent);
  const doc = s.q.obterDocumento({ vendaId: sale.id, documentoId: returned.documentoId });
  assert.equal(doc.itens[0].descricaoHistorica, 'Perfume ciclo histórico');
  assert.equal(doc.itens[0].custoHistoricoCentavos, 200);
  assert.deepEqual(
    doc.movimentosEstoque.map((m) => [m.quantidadeDelta, m.valorDeltaCentavos]),
    [
      [1, 100],
      [1, 100],
      [-1, -100],
    ],
  );
  assert.deepEqual(balance(s), {
    quantidade: beforeStock.quantidade + 1,
    valor_total_centavos: beforeStock.valor_total_centavos + 100,
  });
  const refundId = doc.reembolsoIds[0];
  const refund = () => s.q.obterReembolso({ vendaId: sale.id, reembolsoId: refundId });
  const check = (paid, pending) => {
    assert.equal(refund().valorOriginalCentavos, 15000);
    assert.equal(refund().pagoLiquidoCentavos, paid);
    assert.equal(refund().saldoExigivelCentavos, pending);
    const r = s.q.obterVenda(sale.id).resumo;
    assert.equal(r.valorComercialLiquidoCentavos, 10000);
    assert.equal(r.recebidoLiquidoCentavos, 25000);
    // 3D records the full commercial abatimento; the paid excess becomes a refund.
    assert.equal(r.abatimentosDividaCentavos, 20000);
    assert.equal(r.saldoReceberCentavos, 0);
    assert.equal(r.reembolsosPendentesCentavos, pending);
  };
  check(0, 15000);
  const pay = (pagamentos) =>
    s.execute('financeiro:revisar-pagamento-reembolso', 'financeiro:pagar-reembolso', {
      vendaId: sale.id,
      reembolsoId: refundId,
      dataEfetiva: day,
      pagamentos,
    });
  const undo = (movimentoId) =>
    s.execute('financeiro:revisar-estorno-reembolso', 'financeiro:estornar-reembolso', {
      vendaId: sale.id,
      movimentoId,
      dataEfetiva: day,
    });
  const first = pay([{ formaPagamentoId: s.pix, valorCentavos: 10000 }]);
  check(10000, 5000);
  undo(first.movimentos[0]);
  check(0, 15000);
  const both = pay([
    { formaPagamentoId: s.pix, valorCentavos: 9000 },
    { formaPagamentoId: s.cash, valorCentavos: 6000 },
  ]);
  check(15000, 0);
  undo(both.movimentos[0]);
  check(6000, 9000);
  assert.equal(
    s.q.obterDocumento({ vendaId: sale.id, documentoId: doc.id }).elegibilidadeEstorno.permitido,
    false,
  );
  undo(both.movimentos[1]);
  check(0, 15000);
  s.execute('correcoes:revisar-estorno-devolucao-venda', 'correcoes:estornar-devolucao-venda', {
    vendaId: sale.id,
    documentoId: doc.id,
    dataEfetiva: day,
  });
  assert.equal(refund().ativa, false);
  const final = s.q.obterVenda(sale.id).resumo;
  assert.equal(final.valorComercialLiquidoCentavos, 30000);
  assert.equal(final.saldoReceberCentavos, 5000);
  assert.equal(final.reembolsosPendentesCentavos, 0);
  assert.deepEqual(balance(s), beforeStock);
  // Same original intention after all subsequent financial changes: no new effects.
  const end = snapshot(s.db);
  assert.deepEqual(s.call('correcoes:devolver-venda', intent), returned);
  assert.equal(snapshot(s.db), end);
  assert.equal(reconciliarFinanceiro(s.db), true);
  assert.equal(reconciliarEstoque(s.db).consistente, true);
  s.db.close();
  const reopened = await openDatabase(f.directory, 'test');
  try {
    assert.equal(snapshot(reopened), end);
  } finally {
    reopened.close();
  }
});
