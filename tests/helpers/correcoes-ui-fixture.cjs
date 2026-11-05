const { seedRecebimentos } = require('./recebimentos-ui-fixture.cjs');
const { createFinancialService } = require('../../dist/electron/services/financeiro');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createStockService } = require('../../dist/electron/services/estoque');
const { randomUUID } = require('node:crypto');
const command = (dados) => ({
  operacaoId: randomUUID(),
  motivo: 'Fixture correções isolada',
  dados,
});
function seedCorrecoes(db) {
  const ids = seedRecebimentos(db);
  createFinancialService(db, 'test').registrarRecebimento(
    command({
      vendaId: ids.entry.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: ids.pix, valorCentavos: 15000 }],
    }),
  );
  const product = db.prepare("SELECT * FROM produtos WHERE sku='REC'").get();
  createStockService(db, 'test').registrarEntrada({
    ...command({ produtoId: product.id, quantidade: 10, custoTotalCentavos: 100000 }),
    dataEfetiva: '2026-11-01',
  });
  createCatalogService(db, 'test').saveProduct(
    command({
      id: product.id,
      nome: 'Nome atual inativo',
      sku: product.sku,
      marcaId: product.marca_id,
      categoriaId: product.categoria_id,
      volumeMicrolitros: product.volume_microlitros,
      precoVendaCentavos: product.preco_venda_centavos,
      estoqueMinimo: product.estoque_minimo,
      ativo: false,
    }),
  );
  return { ...ids, productId: product.id };
}
module.exports = { seedCorrecoes };
