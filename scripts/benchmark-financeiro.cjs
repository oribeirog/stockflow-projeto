// Small-shop volumes, real services, isolated data. No schema changes or SQL fixture inserts.
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { cycle, command, day } = require('../tests/helpers/consolidacao-fixture.cjs');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { reconciliarFinanceiro } = require('../dist/electron/services/financeiro-reconciliation');
async function main() {
  mkdirSync('.local-data/test', { recursive: true });
  mkdirSync('.cache', { recursive: true });
  const directory = mkdtempSync(resolve('.local-data/test/financeiro-benchmark-'));
  const db = await openDatabase(directory, 'benchmark');
  const report = {
    data: new Date().toISOString(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    node: process.version,
    sqlite: db.prepare('SELECT sqlite_version() v').get().v,
    directory,
    samples: [],
    notes:
      'Warm OS cache; fixture generation excluded. Synchronous main-process services, not renderer or startup timings. 20 calls per query after one warmup.',
  };
  try {
    const s = cycle(db),
      cor = createCorrectionService(db, 'test'),
      fin = createFinancialService(db, 'test');
    s.buy(2000, 100);
    let count = 0,
      last,
      correction,
      refundId;
    for (const volume of [50, 200, 500]) {
      const seedStart = performance.now();
      db.transaction(() => {
        while (count < volume) {
          last = s.sell(count % 3 === 0 ? 'cash' : count % 3 === 1 ? 'credit' : 'entry');
          if (count % 6 === 0) {
            correction = cor.devolverVenda(
              command({
                documentoId: last.id,
                dataEfetiva: day,
                itens: [{ itemId: last.itens[0].id, quantidade: 1 }],
              }),
            );
            refundId = s.q.obterDocumento({ vendaId: last.id, documentoId: correction.documentoId })
              .reembolsoIds[0];
          }
          count++;
        }
        // Grow one sale's allocation/movement history along with overall volume.
        for (let n = 0; n < volume / 10; n++)
          fin.registrarRecebimento(
            command({
              vendaId: last.id,
              dataEfetiva: day,
              pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 1 }],
            }),
          );
      })();
      const sample = {
        vendas: volume,
        generationMs: performance.now() - seedStart,
        movimentos: db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n,
        parcelas: db.prepare('SELECT count(*) n FROM parcelas_receber').get().n,
        correcoes: db.prepare("SELECT count(*) n FROM documentos WHERE tipo='DEV_VENDA'").get().n,
        queries: {},
      };
      const refundSale = db
        .prepare('SELECT documento_origem_id id FROM documentos WHERE id=?')
        .get(correction.documentoId).id;
      const measurements = {
        listagem: () => s.q.listarParcelas({ situacao: 'TODAS', limite: 25 }),
        filtro: () =>
          s.q.listarParcelas({ clienteId: s.clienteId, situacao: 'EM_ABERTO', limite: 25 }),
        paginacaoFinal: () =>
          s.q.listarParcelas({
            situacao: 'TODAS',
            limite: 25,
            deslocamento: Math.max(0, sample.parcelas - 25),
          }),
        resumo: () => s.q.obterVenda(last.id),
        movimentos: () => s.q.listarMovimentos({ vendaId: last.id, limite: 25 }),
        detalheMovimento: () =>
          s.q.obterMovimento({
            vendaId: last.id,
            movimentoId: s.q.listarMovimentos({ vendaId: last.id }).itens[0].id,
          }),
        reembolsos: () => s.q.listarReembolsos({ situacao: 'PENDENTES', limite: 25 }),
        detalheReembolso: () => s.q.obterReembolso({ vendaId: refundSale, reembolsoId: refundId }),
        detalheCorrecao: () =>
          s.q.obterDocumento({ vendaId: refundSale, documentoId: correction.documentoId }),
      };
      db.pragma('query_only=ON');
      try {
        for (const [name, fn] of Object.entries(measurements)) {
          fn();
          const times = [];
          for (let n = 0; n < 20; n++) {
            const start = performance.now();
            fn();
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          sample.queries[name] = {
            medianaMs: +times[10].toFixed(3),
            p95Ms: +times[18].toFixed(3),
            maxMs: +times[19].toFixed(3),
          };
        }
      } finally {
        db.pragma('query_only=OFF');
      }
      report.samples.push(sample);
      console.log(JSON.stringify(sample));
    }
    assert.equal(reconciliarFinanceiro(db), true);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    writeFileSync('.cache/benchmark-financeiro.json', JSON.stringify(report, null, 2));
  } finally {
    db.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
