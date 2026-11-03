const { randomUUID } = require('node:crypto');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createStockService } = require('../../dist/electron/services/estoque');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const { createFinancialService } = require('../../dist/electron/services/financeiro');
const { createCorrectionService } = require('../../dist/electron/services/correcoes');
const command = (dados) => ({
  operacaoId: randomUUID(),
  motivo: 'Fixture financeira isolada',
  dados,
});
function seedFinanceiro(db) {
  const clock = () => new Date('2026-11-03T15:00:00Z');
  const catalog = createCatalogService(db, 'test');
  const brand = catalog.saveReference('MARCA', command({ nome: 'Marca financeira' }));
  const category = catalog.saveReference('CATEGORIA', command({ nome: 'Categoria financeira' }));
  const productData = {
    sku: 'FIN',
    nome: 'Perfume histórico financeiro',
    marcaId: brand.id,
    categoriaId: category.id,
    volumeMicrolitros: 1000,
    precoVendaCentavos: 10000,
    estoqueMinimo: 0,
  };
  const product = catalog.saveProduct(command(productData));
  const client = catalog.savePerson('CLIENTE', command({ nome: 'Cliente histórico financeiro' }));
  const pix = catalog.saveReference(
    'FORMA_PAGAMENTO',
    command({ nome: 'Pix histórico financeiro' }),
  );
  const stock = createStockService(db, 'test', clock);
  stock.registrarEntrada({
    ...command({ produtoId: product.id, quantidade: 500, custoTotalCentavos: 3000000 }),
    dataEfetiva: '2026-10-31',
  });
  const commercial = createCommercialService(db, 'test', clock);
  const financial = createFinancialService(db, 'test', clock);
  const corrections = createCorrectionService(db, 'test', clock);
  const sale = (quantity, mode = 'A_VISTA', entry = 0, dates = []) => {
    const d = commercial.salvarRascunho(
      command({
        tipo: 'VENDA',
        clienteId: client.id,
        modalidadeVenda: mode,
        dataComercial: '2026-10-31',
        itens: [{ produtoId: product.id, quantidade: quantity, valorUnitarioCentavos: 10000 }],
      }),
    );
    const amount = mode === 'A_VISTA' ? quantity * 10000 : entry;
    const future = quantity * 10000 - amount;
    return commercial[entry ? 'confirmarComEntrada' : 'confirmar'](
      command({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: amount ? [{ formaPagamentoId: pix.id, valorCentavos: amount }] : [],
        parcelas: dates.map((date) => ({ valorCentavos: future / dates.length, vencimento: date })),
      }),
    );
  };
  const integrated = sale(3, 'A_PRAZO', 10000, ['2026-11-01', '2099-01-01']);
  const receipt = financial.registrarRecebimento(
    command({
      vendaId: integrated.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: 15000 }],
    }),
  );
  const correction = corrections.devolverVenda(
    command({
      documentoId: integrated.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: integrated.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
    }),
  );
  const active = financial.listarReembolsos(integrated.id)[0];
  const refundPayment = financial.pagarReembolso(
    command({
      reembolsoId: active.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: 10000 }],
    }),
  );
  const refundReversal = financial.estornarReembolso(
    command({ movimentoId: refundPayment.movimentos[0], dataEfetiva: '2026-11-01' }),
  );
  const annulledSale = sale(1);
  const annulledReturn = corrections.devolverVenda(
    command({
      documentoId: annulledSale.id,
      dataEfetiva: '2026-11-01',
      itens: [{ itemId: annulledSale.itens[0].id, quantidade: 1 }],
    }),
  );
  const annulled = financial.listarReembolsos(annulledSale.id)[0];
  const undo = corrections.estornarDevolucao(
    command({ documentoId: annulledReturn.documentoId, dataEfetiva: '2026-11-01' }),
  );
  const cancelledSale = sale(1);
  const cancellation = corrections.cancelarVenda(
    command({ documentoId: cancelledSale.id, dataEfetiva: '2026-11-01' }),
  );
  const paid = financial.listarReembolsos(cancelledSale.id)[0];
  financial.pagarReembolso(
    command({
      reembolsoId: paid.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: 10000 }],
    }),
  );
  const overdue = sale(3, 'A_PRAZO', 0, ['2026-10-31', '2026-11-01', '2099-01-01']);
  financial.registrarRecebimento(
    command({
      vendaId: overdue.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: 5000 }],
    }),
  );
  const partial = sale(2, 'A_PRAZO', 0, ['2099-01-01', '2099-02-01']);
  financial.registrarRecebimento(
    command({
      vendaId: partial.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: 5000 }],
    }),
  );
  const cash = sale(1);
  for (let n = 0; n < 28; n++) sale(1, 'A_PRAZO', 0, ['2098-01-01']);
  catalog.savePerson(
    'CLIENTE',
    command({ id: client.id, nome: 'Cliente atual inativo', ativo: false }),
  );
  catalog.saveProduct(
    command({ ...productData, id: product.id, nome: 'Perfume atual inativo', ativo: false }),
  );
  catalog.saveReference(
    'FORMA_PAGAMENTO',
    command({ id: pix.id, nome: 'Forma atual inativa', ativo: false }),
  );
  return {
    integrated: integrated.id,
    correction: correction.documentoId,
    active: active.id,
    receipt: receipt.movimentos[0],
    refundPayment: refundPayment.movimentos[0],
    refundReversal: refundReversal.movimentoId,
    annulledSale: annulledSale.id,
    annulledReturn: annulledReturn.documentoId,
    annulled: annulled.id,
    undo: undo.documentoId,
    cancelledSale: cancelledSale.id,
    cancellation: cancellation.documentoId,
    overdue: overdue.id,
    partial: partial.id,
    cash: cash.id,
    client: client.id,
  };
}
function snapshot(db) {
  return JSON.stringify(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all()]),
  );
}
module.exports = { seedFinanceiro, snapshot };
