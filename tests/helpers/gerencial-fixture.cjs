const { command, day } = require('./consolidacao-fixture.cjs');
// More than five equal ranks: verify the Dashboard prefix against complete exports.
function seedRankingTies(s) {
  const sales = [];
  for (let i = 0; i < 6; i++) {
    const nome = [
      '=Produto histórico',
      '+Produto histórico',
      '-Produto histórico',
      '@Produto histórico',
      'Água histórica',
      'Madeira histórica',
    ][i];
    const client = s.cat.savePerson('CLIENTE', command({ nome: `Cliente histórico ${i}` }));
    const data = { ...s.productData, sku: `F4-${i}`, nome };
    const product = s.cat.saveProduct(command(data));
    const buy = s.com.salvarRascunho(
      command({
        tipo: 'COMPRA',
        fornecedorId: s.fornecedorId,
        dataComercial: day,
        itens: [{ produtoId: product.id, quantidade: 6, valorUnitarioCentavos: 100 }],
      }),
    );
    s.com.confirmar(
      command({
        id: buy.id,
        versaoEsperada: buy.versao,
        pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: buy.totalCentavos }],
      }),
    );
    const draft = s.com.salvarRascunho(
      command({
        tipo: 'VENDA',
        modalidadeVenda: 'A_VISTA',
        clienteId: client.id,
        dataComercial: day,
        itens: [{ produtoId: product.id, quantidade: 3, valorUnitarioCentavos: 10000 }],
      }),
    );
    sales.push(
      s.com.confirmar(
        command({
          id: draft.id,
          versaoEsperada: draft.versao,
          pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: draft.totalCentavos }],
        }),
      ),
    );
    s.cat.saveProduct(
      command({
        ...data,
        id: product.id,
        nome: `Nome atual ${i}`,
        ativo: i % 2 === 0,
        estoqueMinimo: 4,
      }),
    );
    s.cat.savePerson(
      'CLIENTE',
      command({ id: client.id, nome: `Cliente atual ${i}`, ativo: i % 2 === 0 }),
    );
  }
  return sales;
}
module.exports = { seedRankingTies };
