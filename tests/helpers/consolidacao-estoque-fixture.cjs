// Only official services write business data; shared by service/UI/benchmark audits.
const { cycle, command, day, clock } = require('./consolidacao-fixture.cjs');
const { createStockService } = require('../../dist/electron/services/estoque');
const {
  createPurchaseCorrectionService,
} = require('../../dist/electron/services/correcoes-compras');
const { createStockReversalService } = require('../../dist/electron/services/estornos-estoque');
function stockCycle(db) {
  const s = cycle(db),
    stock = createStockService(db, '4G3', clock),
    buyCorrections = createPurchaseCorrectionService(db, '4G3', clock),
    reversals = createStockReversalService(db, '4G3', clock);
  const manualData = {
    ...s.productData,
    sku: 'AJ-CICLO',
    nome: '@Ajuste cadastral atual',
    estoqueMinimo: 12,
  };
  const manual = s.cat.saveProduct(command(manualData));
  const cancelProduct = s.cat.saveProduct(
    command({ ...manualData, sku: 'CANCEL-CICLO', nome: 'Compra de custo e resíduo' }),
  );
  const buyProduct = (produtoId, quantidade, value, extra = {}) => {
    const d = s.com.salvarRascunho(
      command({
        tipo: 'COMPRA',
        fornecedorId: s.fornecedorId,
        dataComercial: day,
        itens: [{ produtoId, quantidade, valorUnitarioCentavos: value }],
        ...extra,
      }),
    );
    return s.com.confirmar(
      command({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: d.totalCentavos }],
      }),
    );
  };
  function reviewBuy(dados, cancel = false) {
    const e = command(dados),
      r = buyCorrections[cancel ? 'revisarCancelamento' : 'revisarDevolucao']({
        motivo: e.motivo,
        dados,
      });
    return { ...e, revisao: r.revisao };
  }
  function reviewStock(m, produtoId = manual.id) {
    const e = command({ produtoId, movimentoId: m.movimentacaoId, dataEfetiva: day });
    return {
      ...e,
      revisao: reversals.revisarEstorno({ motivo: e.motivo, dados: e.dados }).revisao,
    };
  }
  const stockCommand = (dados) => ({ ...command(dados), dataEfetiva: day });
  const state = {};
  const returnData = (p, q) => ({
    documentoId: p.id,
    dataEfetiva: day,
    itens: [{ itemId: p.itens[0].id, quantidade: q }],
    pagamentos: [{ formaPagamentoId: s.cash, valorCentavos: q * p.itens[0].valorUnitarioCentavos }],
  });
  const steps = [
    [
      'compra-inicial',
      () => {
        state.first = s.buy(10, 2000);
        state.cancel = buyProduct(cancelProduct.id, 3, 1, {
          freteCentavos: 2,
          despesasDiretasCentavos: 1,
        });
      },
    ],
    [
      'segunda-compra',
      () => {
        state.second = s.buy(10, 4000);
      },
    ],
    [
      'devolucao-compra',
      () => {
        state.returned = buyCorrections.devolver(reviewBuy(returnData(state.first, 2)));
      },
    ],
    [
      'venda-recebimento',
      () => {
        state.sale = s.sell();
        s.execute('financeiro:revisar-recebimento', 'financeiro:registrar-recebimento', {
          vendaId: state.sale.id,
          dataEfetiva: day,
          pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 15000 }],
        });
        state.originalSale = JSON.stringify(
          db
            .prepare('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id')
            .all(state.sale.id),
        );
        s.cat.saveProduct(
          command({
            ...s.productData,
            id: s.productId,
            nome: '=Nome atual diferente & inativo',
            ativo: false,
            estoqueMinimo: 17,
          }),
        );
        s.cat.savePerson(
          'FORNECEDOR',
          command({ id: s.fornecedorId, nome: 'Fornecedor atual renomeado', ativo: false }),
        );
        s.cat.savePerson(
          'CLIENTE',
          command({ id: s.clienteId, nome: '+Cliente cadastral atual', ativo: false }),
        );
      },
    ],
    [
      'devolucao-venda',
      () => {
        state.saleReturn = s.execute(
          'correcoes:revisar-devolucao-venda',
          'correcoes:devolver-venda',
          {
            documentoId: state.sale.id,
            dataEfetiva: day,
            itens: [{ itemId: state.sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
          },
        );
        state.refund = s.q.obterDocumento({
          vendaId: state.sale.id,
          documentoId: state.saleReturn.documentoId,
        }).reembolsoIds[0];
      },
    ],
    [
      'pagamento-reembolso',
      () => {
        state.payment = s.execute(
          'financeiro:revisar-pagamento-reembolso',
          'financeiro:pagar-reembolso',
          {
            vendaId: state.sale.id,
            reembolsoId: state.refund,
            dataEfetiva: day,
            pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 10000 }],
          },
        );
      },
    ],
    [
      'estorno-reembolso',
      () => {
        s.execute('financeiro:revisar-estorno-reembolso', 'financeiro:estornar-reembolso', {
          vendaId: state.sale.id,
          movimentoId: state.payment.movimentos[0],
          dataEfetiva: day,
        });
      },
    ],
    [
      'restauracao-venda',
      () => {
        s.execute(
          'correcoes:revisar-estorno-devolucao-venda',
          'correcoes:estornar-devolucao-venda',
          { vendaId: state.sale.id, documentoId: state.saleReturn.documentoId, dataEfetiva: day },
        );
      },
    ],
    [
      'devolucoes-sucessivas',
      () => {
        for (let n = 0; n < 2; n++) buyCorrections.devolver(reviewBuy(returnData(state.first, 1)));
      },
    ],
    [
      'ajustes-e-estornos',
      () => {
        stock.registrarEntrada(
          stockCommand({ produtoId: manual.id, quantidade: 10, custoTotalCentavos: 1000 }),
        );
        for (const [method, data] of [
          ['registrarEntrada', { quantidade: 5, custoTotalCentavos: 1 }],
          ['registrarSaida', { quantidade: 4 }],
          ['registrarPerda', { quantidade: 1 }],
          ['registrarContagem', { quantidadeContada: 7, versaoEsperada: 0 }],
        ]) {
          if (method === 'registrarContagem')
            data.versaoEsperada = stock.consultarSaldo(manual.id).versao;
          const m = stock[method](stockCommand({ produtoId: manual.id, ...data }));
          state.lastAdjustment = m;
          reversals.estornar(reviewStock(m));
        }
        state.noDifference = stock.registrarContagem(
          stockCommand({
            produtoId: manual.id,
            quantidadeContada: 10,
            versaoEsperada: stock.consultarSaldo(manual.id).versao,
          }),
        );
        state.cancelResult = buyCorrections.cancelar(
          reviewBuy({ documentoId: state.cancel.id, dataEfetiva: day }, true),
        );
      },
    ],
  ];
  return {
    ...s,
    stock,
    buyCorrections,
    reversals,
    manual,
    manualData,
    cancelProduct,
    buyProduct,
    reviewBuy,
    reviewStock,
    stockCommand,
    returnData,
    state,
    steps,
  };
}
module.exports = { stockCycle, day, clock, command };
