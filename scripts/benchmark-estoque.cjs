// Isolated fixtures only. Run with Node, Electron, or the packaged executable in RUN_AS_NODE.
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync, statSync } = require('node:fs');
const { resolve, join } = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const { custoSaida } = require('../dist/electron/domain/custeio.js');
const { reconciliarEstoque } = require('../dist/electron/services/estoque-reconciliation.js');
const {
  estoqueV2,
} = require('../dist/electron/infrastructure/database/migrations/0002-estoque.js');
const root = resolve('.local-data/test');
mkdirSync(root, { recursive: true });
const sessionDirectory = mkdtempSync(join(root, 'stock-benchmark-'));
const guiElectron = !!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1';
let app;
if (guiElectron) {
  app = require('electron').app;
  app.setPath('userData', sessionDirectory);
  app.setPath('sessionData', sessionDirectory);
  app.setPath('crashDumps', sessionDirectory);
}
const sizes = (process.env.MNR_BENCH_SIZES || '1000,10000,100000,1000000').split(',').map(Number);
assert.ok(sizes.every((n, i) => Number.isSafeInteger(n) && n > 0 && (i === 0 || n > sizes[i - 1])));
const now = '2026-10-31T12:00:00.000Z';
const report = {
  createdAt: new Date().toISOString(),
  runtime: process.versions,
  executable: process.execPath,
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  memoryBytes: os.totalmem(),
  sessionDirectory,
  sizes,
  distributions: [],
  notes:
    'OS cache not flushed; first measured open follows generation. Generation is excluded. No application data used.',
};

async function run() {
  for (const products of [1, 100]) {
    const directory = join(sessionDirectory, `products-${products}`);
    mkdirSync(directory);
    let db = await openDatabase(directory, 'benchmark');
    report.sqlite = db.prepare('SELECT sqlite_version() v').get().v;
    const catalog = createCatalogService(db, 'benchmark');
    const cmd = (id, dados) => ({ operacaoId: id, motivo: 'Fixture de desempenho', dados });
    const brand = catalog.saveReference('MARCA', cmd('brand', { nome: 'Marca' }));
    const category = catalog.saveReference('CATEGORIA', cmd('category', { nome: 'Categoria' }));
    const ids = [];
    for (let i = 0; i < products; i++)
      ids.push(
        catalog.saveProduct(
          cmd(`product-${i}`, {
            nome: `Produto ${i}`,
            sku: `BENCH-${i}`,
            marcaId: brand.id,
            categoriaId: category.id,
            volumeMicrolitros: 1000,
            precoVendaCentavos: 100,
            estoqueMinimo: 0,
          }),
        ).id,
      );
    const distribution = { products, directory, samples: [] };
    report.distributions.push(distribution);
    let generated = 0;
    for (const size of sizes) {
      // Reuse prepared statements during fixture generation, outside measured opens.
      const insert = db.prepare(`INSERT INTO movimentacoes_estoque
        (produto_id,natureza,quantidade_delta,valor_delta_centavos,quantidade_apos,valor_apos_centavos,
          versao_apos,motivo,data_efetiva,registrado_em,operacao_id)
        VALUES (?,?,?,?,?,?,?,'Contagem física: fixture de desempenho','2026-10-31',?,?)`);
      const states = ids.map((id) =>
        db
          .prepare(
            'SELECT quantidade q,valor_total_centavos v,versao FROM saldos_estoque WHERE produto_id=?',
          )
          .get(id),
      );
      const generationStart = performance.now();
      // Composite manual adjustments: BigInt cost, one operation/audit per batch.
      // Every movement passes the production SQL triggers; no purchase/sale fixtures.
      while (generated < size) {
        const end = Math.min(generated + 1000, size);
        db.transaction(() => {
          const first = generated;
          const op = `batch-${first}`;
          db.prepare('INSERT INTO operacoes VALUES (?,?,?,?,?)').run(
            op,
            'BENCH_AJUSTES',
            op,
            'null',
            now,
          );
          for (; generated < end; generated++) {
            const productIndex = generated % products;
            const incoming = Math.floor(generated / products) % 2 === 0;
            const state = states[productIndex];
            const deltaQ = incoming ? 1 : -1;
            const deltaV = incoming
              ? 101
              : -Number(custoSaida(BigInt(state.v), BigInt(state.q), 1n));
            state.q += deltaQ;
            state.v += deltaV;
            state.versao++;
            insert.run(
              ids[productIndex],
              incoming ? 'AJUSTE_ENTRADA' : 'AJUSTE_SAIDA',
              deltaQ,
              deltaV,
              state.q,
              state.v,
              state.versao,
              now,
              op,
            );
          }
          const result = JSON.stringify({ first, end });
          db.prepare(
            `INSERT INTO eventos_auditoria
            (operacao_id,evento,motivo,depois_json,registrado_em,versao_aplicativo) VALUES (?,?,?,?,?,?)`,
          ).run(op, 'BENCH_AJUSTES', 'Fixture de desempenho', result, now, 'benchmark');
          db.prepare('UPDATE operacoes SET resultado_json=? WHERE id=?').run(result, op);
        }).immediate();
      }
      const generationMs = performance.now() - generationStart;
      const queryPlan = db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT * FROM movimentacoes_estoque WHERE produto_id=? ORDER BY id',
        )
        .all(ids[0]);
      assert.ok(queryPlan.some((row) => row.detail.includes('estoque_produto')));
      let start = performance.now();
      const reconciliation = reconciliarEstoque(db);
      const reconciliationMs = performance.now() - start;
      assert.equal(reconciliation.consistente, true);
      assert.equal(reconciliation.movimentacoes, size);
      db.close();
      const opens = [];
      for (let repetition = 0; repetition < 3; repetition++) {
        const phases = {};
        start = performance.now();
        db = await openDatabase(directory, 'benchmark', (phase, ms) => {
          phases[phase] = ms;
        });
        opens.push({
          durationMs: performance.now() - start,
          phases,
          rssBytes: process.memoryUsage().rss,
          heapUsedBytes: process.memoryUsage().heapUsed,
        });
        if (repetition < 2) db.close();
      }
      const sample = {
        movements: size,
        generationMs,
        reconciliationMs,
        databaseBytes: statSync(join(directory, 'mnr-perfumes.db')).size,
        opens,
        queryPlan,
      };
      distribution.samples.push(sample);
      console.log('BENCHMARK_SAMPLE', JSON.stringify({ products, ...sample }));
    }
    db.exec('DROP TRIGGER estoque_movimento_imutavel');
    db.prepare(
      'UPDATE movimentacoes_estoque SET quantidade_apos=quantidade_apos+1 WHERE id=(SELECT MAX(id) FROM movimentacoes_estoque)',
    ).run();
    db.exec(
      estoqueV2.sql.match(
        /CREATE TRIGGER estoque_movimento_imutavel[\s\S]*?\nBEGIN[\s\S]*?END;/,
      )[0],
    );
    assert.equal(reconciliarEstoque(db).consistente, false);
    db.close();
    const failureStart = performance.now();
    await assert.rejects(
      openDatabase(directory, 'benchmark'),
      (error) => error.code === 'INTEGRITY',
    );
    distribution.corruptionRejectedMs = performance.now() - failureStart;
  }
  const output = resolve('.cache/stock-benchmark');
  mkdirSync(output, { recursive: true });
  const file = join(
    output,
    `${process.env.MNR_BENCH_LABEL || (process.versions.electron ? 'electron' : 'node')}-${Date.now()}.json`,
  );
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log('BENCHMARK_OK', file);
}
(guiElectron ? app.whenReady() : Promise.resolve())
  .then(run)
  .then(() => app?.quit())
  .catch((error) => {
    console.error(error);
    if (app) app.exit(1);
    else process.exitCode = 1;
  });
