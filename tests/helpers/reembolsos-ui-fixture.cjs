const { randomUUID } = require('node:crypto');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createStockService } = require('../../dist/electron/services/estoque');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const { createFinancialService } = require('../../dist/electron/services/financeiro');
const { createCorrectionService } = require('../../dist/electron/services/correcoes');
const command = (dados) => ({
  operacaoId: randomUUID(),
  motivo: 'Fixture reembolsos/estornos isolada',
  dados,
});
function seedReembolsos(db) {
  const cat = createCatalogService(db, 'test'),
    stock = createStockService(db, 'test'),
    com = createCommercialService(db, 'test'),
    fin = createFinancialService(db, 'test'),
    cor = createCorrectionService(db, 'test');
  const marca = cat.saveReference('MARCA', command({ nome: 'Marca estornos' })),
    categoria = cat.saveReference('CATEGORIA', command({ nome: 'Categoria estornos' })),
    cliente = cat.savePerson('CLIENTE', command({ nome: 'Cliente histórico estornos' })),
    pix = cat.saveReference('FORMA_PAGAMENTO', command({ nome: 'Pix histórico' })),
    receiptPix = cat.saveReference('FORMA_PAGAMENTO', command({ nome: 'Pix recebido histórico' })),
    cash = cat.saveReference('FORMA_PAGAMENTO', command({ nome: 'Dinheiro histórico' }));
  const make = (label, returned = true, loss = 1) => {
    const productData = {
        sku: 'EST-' + label,
        nome: 'Perfume histórico ' + label,
        marcaId: marca.id,
        categoriaId: categoria.id,
        volumeMicrolitros: 1000,
        precoVendaCentavos: 10000,
        estoqueMinimo: 0,
      },
      product = cat.saveProduct(command(productData));
    stock.registrarEntrada({
      ...command({ produtoId: product.id, quantidade: 20, custoTotalCentavos: 2000 }),
      dataEfetiva: '2026-10-31',
    });
    const draft = com.salvarRascunho(
      command({
        tipo: 'VENDA',
        clienteId: cliente.id,
        modalidadeVenda: 'A_PRAZO',
        dataComercial: '2026-10-31',
        itens: [{ produtoId: product.id, quantidade: 3, valorUnitarioCentavos: 10000 }],
      }),
    );
    const sale = com.confirmarComEntrada(
      command({
        id: draft.id,
        versaoEsperada: draft.versao,
        pagamentos: [{ formaPagamentoId: pix.id, valorCentavos: 10000 }],
        parcelas: [
          { vencimento: '2099-01-01', valorCentavos: 10000 },
          { vencimento: '2099-02-01', valorCentavos: 10000 },
        ],
      }),
    );
    const receipt = fin.registrarRecebimento(
      command({
        vendaId: sale.id,
        dataEfetiva: '2026-11-01',
        pagamentos: returned
          ? [{ formaPagamentoId: pix.id, valorCentavos: 15000 }]
          : [
              { formaPagamentoId: receiptPix.id, valorCentavos: 6000 },
              { formaPagamentoId: cash.id, valorCentavos: 4000 },
            ],
      }),
    );
    stock.registrarEntrada({
      ...command({ produtoId: product.id, quantidade: 5, custoTotalCentavos: 50000 }),
      dataEfetiva: '2026-11-01',
    });
    const returnedDoc = returned
      ? cor.devolverVenda(
          command({
            documentoId: sale.id,
            dataEfetiva: '2026-11-01',
            itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: loss }],
          }),
        )
      : null;
    const refund = returnedDoc
      ? db
          .prepare('SELECT id FROM reembolsos_cliente WHERE documento_correcao_id=?')
          .get(returnedDoc.documentoId).id
      : null;
    cat.saveProduct(
      command({ ...productData, id: product.id, nome: 'Nome atual ' + label, ativo: false }),
    );
    return {
      saleId: sale.id,
      productId: product.id,
      correcaoId: returnedDoc?.documentoId ?? null,
      reembolsoId: refund,
      recebimentos: receipt.movimentos,
      entrada: db
        .prepare('SELECT id FROM movimentos_financeiros WHERE documento_id=? AND operacao_id=?')
        .get(
          sale.id,
          sale.operacaoConfirmacaoId ??
            db.prepare('SELECT operacao_confirmacao_id FROM documentos WHERE id=?').get(sale.id)
              .operacao_confirmacao_id,
        ).id,
    };
  };
  const main = make('principal'),
    other = make('outra'),
    blocked = make('bloqueada'),
    receipt = make('recebimento', false),
    apt = make('apta', true, 0),
    improper = make('impropria', true, 2),
    annulled = make('anulada');
  stock.registrarEntrada({
    ...command({ produtoId: blocked.productId, quantidade: 1, custoTotalCentavos: 777 }),
    dataEfetiva: '2026-11-01',
  });
  cor.estornarDevolucao(command({ documentoId: annulled.correcaoId, dataEfetiva: '2026-11-01' }));
  cat.savePerson(
    'CLIENTE',
    command({ id: cliente.id, nome: 'Cliente atual inativo', ativo: false }),
  );
  return { main, other, blocked, receipt, apt, improper, annulled, pix: pix.id, cash: cash.id };
}
module.exports = { seedReembolsos, command };
