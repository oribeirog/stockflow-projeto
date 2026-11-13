const { randomUUID } = require('node:crypto');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const cmd = (dados) => ({ operacaoId: randomUUID(), motivo: 'Teste isolado de compras', dados });
function seedComprasCorrecoes(db) {
  const clock = () => new Date('2026-11-12T15:00:00Z'),
    catalog = createCatalogService(db, 'test');
  const brand = catalog.saveReference('MARCA', cmd({ nome: 'Marca compras' })),
    category = catalog.saveReference('CATEGORIA', cmd({ nome: 'Categoria compras' }));
  const productData = {
    sku: 'CC-1',
    nome: 'Perfume histórico Águas e flores ' + 'X'.repeat(90),
    marcaId: brand.id,
    categoriaId: category.id,
    volumeMicrolitros: 1000,
    precoVendaCentavos: 5000,
    estoqueMinimo: 2,
  };
  const product = catalog.saveProduct(cmd(productData));
  const second = catalog.saveProduct(cmd({ ...productData, sku: 'CC-2', nome: 'Outro perfume' }));
  const supplier = catalog.savePerson('FORNECEDOR', cmd({ nome: 'Fornecedor histórico São João' }));
  const form = catalog.saveReference('FORMA_PAGAMENTO', cmd({ nome: 'Pix compras' }));
  const commercial = createCommercialService(db, 'test', clock);
  const purchase = (q = 10, value = 2000, extra = {}) => {
    const d = commercial.salvarRascunho(
      cmd({
        tipo: 'COMPRA',
        fornecedorId: supplier.id,
        dataComercial: '2026-11-01',
        itens: [{ produtoId: product.id, quantidade: q, valorUnitarioCentavos: value }],
        ...extra,
      }),
    );
    return commercial.confirmar(
      cmd({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: d.totalCentavos
          ? [{ formaPagamentoId: form.id, valorCentavos: d.totalCentavos }]
          : [],
      }),
    );
  };
  const sale = (q = 4) => {
    const d = commercial.salvarRascunho(
      cmd({
        tipo: 'VENDA',
        modalidadeVenda: 'A_VISTA',
        dataComercial: '2026-11-02',
        itens: [{ produtoId: product.id, quantidade: q, valorUnitarioCentavos: 5000 }],
      }),
    );
    return commercial.confirmar(
      cmd({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: [{ formaPagamentoId: form.id, valorCentavos: d.totalCentavos }],
      }),
    );
  };
  return {
    catalog,
    commercial,
    product,
    second,
    productData,
    supplier,
    form,
    purchase,
    sale,
    clock,
  };
}
module.exports = { seedComprasCorrecoes, cmd };
