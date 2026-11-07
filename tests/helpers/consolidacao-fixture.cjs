// Purchase-funded fixture: no manual stock entry and no direct commercial SQL writes.
const { randomUUID } = require('node:crypto');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const { criarHandlersConsultasFinanceiras } = require('../../dist/electron/ipc/financeiro');
const { createFinancialQueryService } = require('../../dist/electron/services/financeiro-consulta');
const command = (dados) => ({ operacaoId: randomUUID(), motivo: 'Consolidação isolada', dados });
const day = '2026-11-01';
const clock = () => new Date('2026-11-06T15:00:00Z');
function cycle(db) {
  const cat = createCatalogService(db, 'test', clock);
  const marca = cat.saveReference('MARCA', command({ nome: 'Marca ciclo' }));
  const categoria = cat.saveReference('CATEGORIA', command({ nome: 'Categoria ciclo' }));
  const cliente = cat.savePerson('CLIENTE', command({ nome: 'Cliente ciclo histórico' }));
  const fornecedor = cat.savePerson('FORNECEDOR', command({ nome: 'Fornecedor ciclo' }));
  const pix = cat.saveReference('FORMA_PAGAMENTO', command({ nome: 'Pix ciclo' })).id;
  const cash = cat.saveReference('FORMA_PAGAMENTO', command({ nome: 'Dinheiro ciclo' })).id;
  const productData = {
    nome: 'Perfume ciclo histórico',
    sku: 'CICLO',
    marcaId: marca.id,
    categoriaId: categoria.id,
    volumeMicrolitros: 1000,
    precoVendaCentavos: 10000,
    estoqueMinimo: 0,
  };
  const productId = cat.saveProduct(command(productData)).id;
  const com = createCommercialService(db, 'test', clock);
  const buy = (quantidade, valorUnitarioCentavos) => {
    const d = com.salvarRascunho(
      command({
        tipo: 'COMPRA',
        fornecedorId: fornecedor.id,
        dataComercial: day,
        itens: [{ produtoId: productId, quantidade, valorUnitarioCentavos }],
      }),
    );
    return com.confirmar(
      command({
        id: d.id,
        versaoEsperada: d.versao,
        pagamentos: [{ formaPagamentoId: cash, valorCentavos: d.totalCentavos }],
      }),
    );
  };
  const sell = (mode = 'entry') => {
    const d = com.salvarRascunho(
      command({
        tipo: 'VENDA',
        clienteId: cliente.id,
        modalidadeVenda: mode === 'cash' ? 'A_VISTA' : 'A_PRAZO',
        dataComercial: day,
        itens: [{ produtoId: productId, quantidade: 3, valorUnitarioCentavos: 10000 }],
      }),
    );
    const dados = { id: d.id, versaoEsperada: d.versao };
    if (mode !== 'credit')
      dados.pagamentos = [
        { formaPagamentoId: pix, valorCentavos: mode === 'entry' ? 10000 : 30000 },
      ];
    if (mode !== 'cash')
      dados.parcelas = [
        { vencimento: '2026-12-01', valorCentavos: mode === 'entry' ? 10000 : 15000 },
        { vencimento: '2027-01-01', valorCentavos: mode === 'entry' ? 10000 : 15000 },
      ];
    return mode === 'entry'
      ? com.confirmarComEntrada(command(dados))
      : com.confirmar(command(dados));
  };
  const handlers = criarHandlersConsultasFinanceiras(db, clock, 'test');
  const call = (method, input) => {
    const r = handlers.get(method)(input);
    if (!r.ok) throw Object.assign(new Error(JSON.stringify(r.error)), r.error);
    return r.data;
  };
  const intention = (review, dados) => ({
    ...command(dados),
    revisao: call(review, { motivo: 'Consolidação isolada', dados }).revisao,
  });
  const execute = (review, method, dados) => call(method, intention(review, dados));
  return {
    db,
    cat,
    com,
    productData,
    productId,
    clienteId: cliente.id,
    fornecedorId: fornecedor.id,
    pix,
    cash,
    buy,
    sell,
    call,
    intention,
    execute,
    q: createFinancialQueryService(db, clock),
  };
}
module.exports = { cycle, command, day, clock };
