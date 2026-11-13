const { app, protocol } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve, join, relative, isAbsolute } = require('node:path');
const { spawnSync } = require('node:child_process');
const { homedir, release } = require('node:os');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { coletarDocumento } = require('../dist/electron/services/exportacoes/documento');
const { gerarExcel } = require('../dist/electron/services/exportacoes/xlsx');
const { gerarPdf } = require('../dist/electron/services/exportacoes/pdf');
const { salvarArquivo } = require('../dist/electron/services/exportacoes/arquivos');
const { MODELOS_RELATORIO } = require('../dist/shared/exportacoes');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
protocol.registerSchemesAsPrivileged([
  { scheme: 'mnr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
mkdirSync('.local-data/test', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/export-benchmark-'));
mkdirSync(join(root, 'profile', 'chromium'), { recursive: true });
app.setPath('userData', join(root, 'profile'));
app.setPath('sessionData', join(root, 'profile', 'chromium'));
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    const stockIntegration = process.argv.includes('--consolidacao-estoque');
    const checkpoints = JSON.parse(
      readFileSync(
        stockIntegration
          ? '.cache/benchmark-4g3-consultas.json'
          : '.cache/benchmark-relatorios.json',
        'utf8',
      ),
    );
    const results = {
      createdAt: new Date().toISOString(),
      os: release(),
      runtime: process.versions,
      source: stockIntegration
        ? 'Read-only 4G3 mixed-operation checkpoints; fixture generation excluded'
        : 'Read-only validated 4F1 checkpoints, no fixture generation in timings',
      samples: [],
      outputs: root,
    };
    const manifest = [];
    for (const volume of [50, 200, 500]) {
      const source = checkpoints.samples.find((s) => s.vendas === volume).checkpoint;
      const rel = relative(resolve('.local-data/test'), resolve(source));
      assert(!rel.startsWith('..') && !isAbsolute(rel));
      const path = join(source, 'mnr-perfumes.db');
      assert(existsSync(path));
      const db = new Database(path, { readonly: true, fileMustExist: true });
      db.pragma('query_only=ON');
      const before = snapshot(db);
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM documentos WHERE tipo='VENDA' AND estado IN ('CONFIRMADO','ESTORNADO')",
          )
          .get().n,
        volume,
      );
      const start = performance.now();
      for (const { id } of MODELOS_RELATORIO) {
        const filtros = ['CONTAS', 'REEMBOLSOS', 'ESTOQUE'].includes(id)
          ? {}
          : { dataInicio: '2026-10-01', dataFim: '2026-12-31' };
        const t = performance.now(),
          d = coletarDocumento(db, { modelo: id, filtros });
        const collectMs = performance.now() - t;
        for (const format of ['xlsx', 'pdf']) {
          const g = performance.now(),
            bytes = format === 'xlsx' ? await gerarExcel(d) : await gerarPdf(d);
          const filename = join(root, `${volume}-${id}.${format}`);
          await salvarArquivo(filename, format, bytes, []);
          manifest.push({ path: filename, documento: d });
          results.samples.push({
            vendas: volume,
            modelo: id,
            formato: format,
            linhas: d.registros,
            coletaMs: collectMs,
            geracaoGravacaoMs: performance.now() - g,
            bytes: bytes.length,
            rss: process.memoryUsage().rss,
          });
        }
      }
      assert.equal(snapshot(db), before);
      db.close();
      console.log('EXPORT_BENCHMARK_VOLUME_OK', volume, Math.round(performance.now() - start));
    }
    const precision = {
      titulo: 'Precisão e caracteres brasileiros',
      modelo: 'ESTOQUE',
      geradoEm: new Date().toISOString(),
      referencia: '2026-11-10',
      criterios: ['Ensaio isolado do formato'],
      notas: ['Dados sintéticos exclusivamente para teste de renderização.'],
      registros: 5,
      secoes: [
        {
          nome: 'Precisão',
          nota: 'Valores pequenos, negativos e grandes sem arredondamento adicional.',
          colunas: [
            { titulo: 'Texto', tipo: 'texto', largura: 46 },
            { titulo: 'Valor (R$)', tipo: 'moeda', largura: 30 },
            { titulo: 'Data', tipo: 'data', largura: 20 },
          ],
          linhas: [
            '=Água & <Madeira>',
            '+SUM(1,1)',
            '-1+1',
            '@SOMA(A1)',
            'Nome longo com acentuação brasileira '.repeat(6),
          ].map((s, i) => [
            s,
            [-1, 1, -100, 100, 999999999999999][i],
            ['0000-01-01', '1900-01-01', '1900-02-28', '1900-03-01', '9999-12-31'][i],
          ]),
        },
      ],
    };
    for (const format of ['xlsx', 'pdf']) {
      const filename = join(root, `precisao.${format}`);
      await salvarArquivo(
        filename,
        format,
        format === 'xlsx' ? await gerarExcel(precision) : await gerarPdf(precision),
        [],
      );
      manifest.push({ path: filename, documento: precision });
    }
    const manifestPath = join(root, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const python =
      process.env.MNR_TEST_PYTHON ??
      join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    const checked = spawnSync(python, ['scripts/verify-exportacoes.py', manifestPath], {
      stdio: 'inherit',
    });
    assert.equal(checked.status, 0);
    results.manifest = manifestPath;
    writeFileSync(
      stockIntegration
        ? '.cache/benchmark-4g3-exportacoes.json'
        : '.cache/benchmark-exportacoes.json',
      JSON.stringify(results, null, 2),
    );
    console.log('EXPORT_BENCHMARK_OK', results.samples.length);
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
