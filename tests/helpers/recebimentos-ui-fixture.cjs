const { randomUUID } = require('node:crypto');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createStockService } = require('../../dist/electron/services/estoque');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const command = (dados) => ({
  operacaoId: randomUUID(),
  motivo: 'Fixture recebimentos isolada',
  dados,
});
function seedRecebimentos(db) {
  const catalog = createCatalogService(db, 'test');
  const brand = catalog.saveReference('MARCA', command({ nome: 'Marca recebimentos' }));
  const category = catalog.saveReference('CATEGORIA', command({ nome: 'Categoria recebimentos' }));
  const product = catalog.saveProduct(
    command({
      sku: 'REC',
      nome: 'Perfume recebimentos',
      marcaId: brand.id,
      categoriaId: category.id,
      volumeMicrolitros: 1000,
      precoVendaCentavos: 10000,
      estoqueMinimo: 0,
    }),
  );
  const client = catalog.savePerson('CLIENTE', command({ nome: 'Cliente histórico recebimentos' }));
  const pix = catalog.saveReference('FORMA_PAGAMENTO', command({ nome: 'Pix' }));
  const cash = catalog.saveReference('FORMA_PAGAMENTO', command({ nome: 'Dinheiro' }));
  createStockService(db, 'test').registrarEntrada({
    ...command({ produtoId: product.id, quantidade: 100, custoTotalCentavos: 1000 }),
    dataEfetiva: '2026-10-31',
  });
  const commercial = createCommercialService(db, 'test');
  const sale = (entry = false) => {
    const d = commercial.salvarRascunho(
      command({
        tipo: 'VENDA',
        clienteId: client.id,
        modalidadeVenda: 'A_PRAZO',
        dataComercial: '2026-10-31',
        itens: [{ produtoId: product.id, quantidade: 3, valorUnitarioCentavos: 10000 }],
      }),
    );
    return commercial[entry ? 'confirmarComEntrada' : 'confirmar'](
      command({
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
  const main = sale(),
    other = sale(),
    entry = sale(true),
    fault = sale();
  catalog.savePerson(
    'CLIENTE',
    command({ id: client.id, nome: 'Cliente renomeado', ativo: false }),
  );
  return { main, other, entry, fault, pix: pix.id, cash: cash.id };
}
module.exports = { seedRecebimentos };
