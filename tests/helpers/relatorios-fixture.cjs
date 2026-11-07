const { cycle, command, clock, day } = require('./consolidacao-fixture.cjs');
const { createFinancialService } = require('../../dist/electron/services/financeiro');
const { createCorrectionService } = require('../../dist/electron/services/correcoes');
function seedRelatorios(db) {
  const s = cycle(db);
  s.buy(20, 100);
  const sale = s.sell();
  createFinancialService(db, 'test', clock).registrarRecebimento(
    command({
      vendaId: sale.id,
      dataEfetiva: day,
      pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 15000 }],
    }),
  );
  s.buy(5, 10000);
  const d = createCorrectionService(db, 'test', clock).devolverVenda(
    command({
      documentoId: sale.id,
      dataEfetiva: day,
      itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
    }),
  );
  const reembolsoId = s.q.obterDocumento({ vendaId: sale.id, documentoId: d.documentoId })
    .reembolsoIds[0];
  return {
    saleId: sale.id,
    productId: s.productId,
    clienteId: s.clienteId,
    pix: s.pix,
    correcaoId: d.documentoId,
    reembolsoId,
  };
}
module.exports = { seedRelatorios };
