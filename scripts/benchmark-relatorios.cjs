const { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { cycle, command, day, clock } = require('../tests/helpers/consolidacao-fixture.cjs');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { createReportService } = require('../dist/electron/services/relatorios');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { createFinancialService } = require('../dist/electron/services/financeiro');
async function main() {
  const stockIntegration = process.argv.includes('--consolidacao-estoque');
  const resultPath = stockIntegration
    ? '.cache/benchmark-4g3-consultas.json'
    : '.cache/benchmark-relatorios.json';
  mkdirSync('.local-data/test', { recursive: true });
  mkdirSync('.cache', { recursive: true });
  const previous = process.argv.includes('--checkpoints')
    ? JSON.parse(readFileSync('.cache/benchmark-relatorios.json', 'utf8'))
    : null;
  const directory = previous
    ? previous.directory
    : mkdtempSync(resolve('.local-data/test/relatorios-benchmark-'));
  let db = previous ? null : await openDatabase(directory, 'benchmark');
  let s = previous
      ? null
      : stockIntegration
        ? require('../tests/helpers/consolidacao-estoque-fixture.cjs').stockCycle(db)
        : cycle(db),
    r = previous ? null : createReportService(db, clock);
  const cor = previous ? null : createCorrectionService(db, 'test', clock),
    fin = previous ? null : createFinancialService(db, 'test', clock);
  const report = {
    createdAt: new Date().toISOString(),
    directory,
    os: os.release(),
    cpu: os.cpus()[0].model,
    runtime: process.versions,
    samples: [],
    reusedCheckpoints: !!previous,
    notes:
      'Real-service generation excluded; warm OS cache, 20 samples after warmup. Main process only.',
  };
  const range = { dataInicio: '2026-10-01', dataFim: '2026-12-31' };
  let count = 0;
  try {
    if (!previous) {
      if (stockIntegration) {
        for (const [, run] of s.steps) run();
        s.cat.saveProduct(command({ ...s.productData, id: s.productId, ativo: true }));
        s.cat.savePerson(
          'FORNECEDOR',
          command({ id: s.fornecedorId, nome: 'Fornecedor benchmark', ativo: true }),
        );
        s.cat.savePerson(
          'CLIENTE',
          command({ id: s.clienteId, nome: 'Cliente benchmark', ativo: true }),
        );
        count = 1;
      }
      s.buy(2000, 100);
    }
    for (const volume of [50, 200, 500]) {
      const source = previous?.samples.find((x) => x.vendas === volume);
      if (previous) {
        const checkpoint = resolve(source.checkpoint);
        assert.ok(checkpoint.startsWith(resolve('.local-data/test') + require('node:path').sep));
        db = await openDatabase(checkpoint, 'benchmark');
        r = createReportService(db, clock);
        s = {
          clienteId: db.prepare('SELECT id FROM clientes ORDER BY id LIMIT 1').get().id,
          productId: db.prepare("SELECT id FROM produtos WHERE sku='CICLO'").get().id,
        };
      }
      const start = performance.now();
      while (!previous && count < volume) {
        const batchEnd = stockIntegration ? Math.min(count + 10, volume) : volume;
        db.transaction(() => {
          while (count < batchEnd) {
            const sale = s.sell(count % 3 === 0 ? 'cash' : count % 3 === 1 ? 'credit' : 'entry');
            if (count % 6 === 0)
              cor.devolverVenda(
                command({
                  documentoId: sale.id,
                  dataEfetiva: day,
                  itens: [{ itemId: sale.itens[0].id, quantidade: 1 }],
                }),
              );
            if (count % 3 === 1)
              fin.registrarRecebimento(
                command({
                  vendaId: sale.id,
                  dataEfetiva: day,
                  pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 1000 }],
                }),
              );
            count++;
          }
        })();
        if (stockIntegration) {
          // Let Node finalize setup resources between bounded fixture batches.
          // Fixture creation is excluded from the measured query/write timings.
          global.gc?.();
          await new Promise(setImmediate);
        }
      }
      const sample = {
        vendas: volume,
        generationMs: previous ? source.generationMs : performance.now() - start,
        parcelas: db.prepare('SELECT count(*) n FROM parcelas_receber').get().n,
        movimentos: db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n,
        queries: {},
        memoryBefore: process.memoryUsage(),
      };
      if (stockIntegration) {
        const dados = s.returnData(s.state.first, 1),
          times = [];
        let intent;
        db.pragma('query_only=ON');
        try {
          for (let n = 0; n < 21; n++) {
            const start = performance.now();
            intent = s.reviewBuy(dados);
            if (n) times.push(performance.now() - start);
          }
        } finally {
          db.pragma('query_only=OFF');
        }
        times.sort((a, b) => a - b);
        const start = performance.now();
        s.buyCorrections.devolver(intent);
        sample.devolucaoCompra = {
          revisaoMedianaMs: times[10],
          revisaoP95Ms: times[18],
          confirmacaoMs: performance.now() - start,
        };
        const adjustment = s.stock.registrarEntrada(
          s.stockCommand({ produtoId: s.manual.id, quantidade: 1, custoTotalCentavos: 1 }),
        );
        const reviewStart = performance.now(),
          reversal = s.reviewStock(adjustment),
          reviewMs = performance.now() - reviewStart;
        const writeStart = performance.now();
        s.reversals.estornar(reversal);
        sample.estornoAjuste = {
          revisaoMs: reviewMs,
          confirmacaoMs: performance.now() - writeStart,
        };
      }
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM documentos WHERE tipo='VENDA' AND estado IN ('CONFIRMADO','ESTORNADO')",
          )
          .get().n,
        volume,
      );
      const queries = {
        resumo: () => r.obterResumoGerencial(range),
        serieVendas: () => r.obterSeriesVendas({ ...range, agrupamento: 'DIARIO' }),
        serieRecebimentos: () => r.obterSeriesRecebimentos({ ...range, agrupamento: 'MENSAL' }),
        vendas: () => r.listarVendas(range),
        ranking: () => r.listarProdutos(range),
        clientes: () => r.listarClientes(range),
        movimentos: () => r.listarMovimentos(range),
        porForma: () => r.listarTotaisPorForma(range),
        contas: () => r.listarContasReceber({}),
        reembolsos: () => r.listarReembolsos({}),
        estoque: () => r.obterResumoEstoque(range),
        saldos: () => r.listarSaldos({}),
        movimentacaoProdutos: () => r.listarMovimentacaoProdutos(range),
        paginacao: () => r.listarVendas({ ...range, deslocamento: volume - 25 }),
        filtro: () =>
          r.listarVendas({
            ...range,
            clienteId: s.clienteId,
            produtoId: s.productId,
            ordem: 'VALOR_DESC',
          }),
      };
      db.pragma('query_only=ON');
      try {
        for (const [name, fn] of Object.entries(queries)) {
          fn();
          const times = [];
          for (let i = 0; i < 20; i++) {
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
      sample.memoryAfter = process.memoryUsage();
      sample.processMaxRssKiB = process.resourceUsage().maxRSS;
      const checkpoint = source?.checkpoint ?? resolve(directory, 'volume-' + volume);
      if (!previous) {
        mkdirSync(checkpoint);
        const destination = resolve(checkpoint, 'mnr-perfumes.db');
        assert.equal(existsSync(destination), false);
        const bytes =
          db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
        assert.ok(bytes <= 50 * 1024 * 1024, 'Checkpoint fixture exceeds benchmark memory budget');
        writeFileSync(destination, db.serialize());
      }
      sample.checkpoint = checkpoint;
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
      console.log(JSON.stringify(sample));
      if (previous) {
        db.close();
        db = null;
      }
    }
    writeFileSync(resultPath, JSON.stringify(report, null, 2));
  } finally {
    if (db?.open) db.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
