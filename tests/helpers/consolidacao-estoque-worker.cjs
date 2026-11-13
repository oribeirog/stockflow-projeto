const { parentPort, workerData: d } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const {
  createPurchaseCorrectionService,
} = require('../../dist/electron/services/correcoes-compras');
const cmd = (dados) => ({ operacaoId: randomUUID(), motivo: 'Concorrência entre módulos', dados });
(async () => {
  const db = await openDatabase(d.directory, 'test');
  try {
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(d.gate), 0, 0);
    try {
      if (d.action === 'return')
        parentPort.postMessage({
          result: createPurchaseCorrectionService(db, 'test').devolver(d.command),
        });
      else {
        const service = createCommercialService(db, 'test'),
          sale = d.action === 'sale';
        const draft = service.salvarRascunho(
          cmd({
            tipo: sale ? 'VENDA' : 'COMPRA',
            ...(!sale ? { fornecedorId: d.supplier } : { modalidadeVenda: 'A_VISTA' }),
            dataComercial: '2026-11-01',
            itens: [{ produtoId: d.product, quantidade: 1, valorUnitarioCentavos: 2000 }],
          }),
        );
        parentPort.postMessage({
          result: service.confirmar(
            cmd({
              id: draft.id,
              versaoEsperada: draft.versao,
              pagamentos: [{ formaPagamentoId: d.form, valorCentavos: draft.totalCentavos }],
            }),
          ),
        });
      }
    } catch (e) {
      parentPort.postMessage({ code: e.code });
    }
  } finally {
    db.close();
  }
})();
