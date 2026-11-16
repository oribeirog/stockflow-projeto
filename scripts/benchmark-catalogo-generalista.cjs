// Isolated synthetic catalog benchmark; timings exclude Angular, IPC and PDF.
const fs = require('node:fs'),
  { resolve, join } = require('node:path'),
  { performance } = require('node:perf_hooks');
const { openDatabase } = require('../dist/electron/infrastructure/database'),
  { createCatalogService } = require('../dist/electron/services/catalogos'),
  { createReportService } = require('../dist/electron/services/relatorios'),
  { coletarDocumento } = require('../dist/electron/services/exportacoes/documento'),
  { gerarExcel } = require('../dist/electron/services/exportacoes/xlsx');
const { command } = require('../tests/helpers/consolidacao-fixture.cjs');
function measure(run, n = 100) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { calls: n, medianMs: times[Math.floor(n / 2)], p95Ms: times[Math.floor(n * 0.95)] };
}
(async () => {
  fs.mkdirSync('.local-data/test', { recursive: true });
  fs.mkdirSync('.cache', { recursive: true });
  const results = [];
  for (const count of [50, 200, 500]) {
    const root = fs.mkdtempSync(resolve('.local-data/test/catalogo-benchmark-'));
    fs.mkdirSync(join(root, 'data'));
    const db = await openDatabase(join(root, 'data'), 'benchmark');
    try {
      const cat = createCatalogService(db, 'benchmark'),
        brand = cat.saveReference('MARCA', command({ nome: 'Marca geral' })),
        category = cat.saveReference('CATEGORIA', command({ nome: 'Mercadorias' }));
      let last;
      for (let i = 0; i < count; i++)
        last = cat.saveProduct(
          command({
            nome: 'Produto generalista ' + i,
            sku: 'CAT-' + i,
            codigoBarras: String(i).padStart(13, '0'),
            marcaId: brand.id,
            categoriaId: category.id,
            unidadeComercial: i % 2 ? 'CX' : 'UN',
            precoVendaCentavos: 10001,
            estoqueMinimo: 2,
          }),
        );
      db.pragma('query_only=ON');
      const reports = createReportService(db),
        period = { dataInicio: '2026-11-01', dataFim: '2026-11-30' },
        queries = {
          list: measure(() => cat.listProducts({ limite: 25 })),
          sku: measure(() => cat.listProducts({ busca: last.sku })),
          barcode: measure(() => cat.listProducts({ busca: last.codigoBarras })),
          get: measure(() => cat.getProduct(last.id)),
          dashboardSummary: measure(() => reports.obterResumoGerencial(period), 20),
        };
      const start = performance.now(),
        d = coletarDocumento(db, { modelo: 'ESTOQUE', filtros: {} }),
        collectMs = performance.now() - start,
        x = performance.now(),
        bytes = await gerarExcel(d);
      results.push({
        count,
        queries,
        collectMs,
        xlsxMs: performance.now() - x,
        xlsxBytes: bytes.byteLength,
        records: d.secoes.find((s) => s.nome === 'Estoque').linhas.length,
        dbBytes: fs.statSync(db.name).size,
        walBytes: fs.existsSync(db.name + '-wal') ? fs.statSync(db.name + '-wal').size : 0,
        sqliteVersion: db.prepare('SELECT sqlite_version() AS version').get().version,
        memory: process.memoryUsage(),
        root,
      });
      if (results.at(-1).records !== count) throw Error('Incomplete benchmark export');
    } finally {
      db.close();
    }
  }
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    betterSqlite3: require('better-sqlite3/package.json').version,
    sqlite: results[0].sqliteVersion,
    scope:
      'Node service/collection/XLSX only; warm cache; memory point sample, not peak; no renderer/IPC/PDF measurement',
    results,
  };
  fs.writeFileSync('.cache/pre52a-catalogo-benchmark.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
