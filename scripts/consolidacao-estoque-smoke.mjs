// Reuses the 4F4 Dashboard/files auditor over one 4G1/4G2 chain. No production hooks.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
import { connect, pause } from './exportacoes-cdp.mjs';
import { auditCheckpoint } from './consolidacao-gerencial-scenario.mjs';
const require = createRequire(import.meta.url),
  { openDatabase } = require('../dist/electron/infrastructure/database'),
  { stockCycle, clock, day } = require('../tests/helpers/consolidacao-estoque-fixture.cjs'),
  { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs'),
  { coletarDocumento } = require('../dist/electron/services/exportacoes/documento'),
  { reconciliarEstoque } = require('../dist/electron/services/estoque-reconciliation'),
  { reconciliarFinanceiro } = require('../dist/electron/services/financeiro-reconciliation');
const packaged = process.argv.includes('--package'),
  development = process.argv.includes('--development');
assert(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
mkdirSync('.cache/ui', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/ui-consolidacao-estoque-')),
  directory = packaged ? join(root, 'MNR Software/MNR Perfumes/data') : join(root, 'data'),
  outputs = mkdtempSync(resolve('.local-data/test/exports-4g3-'));
mkdirSync(directory, { recursive: true });
const db = await openDatabase(directory, 'test'),
  s = stockCycle(db),
  manifest = [],
  audits = [],
  mode = packaged ? 'package' : development ? 'http' : 'local';
let server,
  persisted,
  serial = 0;
try {
  if (development) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      env: environment(),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    let ready = false;
    for (let n = 0; n < 120; n++) {
      if (server.exitCode !== null) throw Error('HTTP encerrou');
      try {
        if ((await fetch('http://127.0.0.1:4200')).ok) {
          ready = true;
          break;
        }
      } catch {
        /*startup*/
      }
      await pause(500);
    }
    assert(ready);
  }
  for (const reopen of [false, true]) {
    const child = spawn(
      packaged ? resolve('release/win-unpacked/MNR Perfumes.exe') : electron,
      [...(packaged ? [] : ['.']), '--inspect=19258', '--remote-debugging-port=19259'],
      {
        cwd: packaged ? root : process.cwd(),
        env: environment({
          MNR_SMOKE: '0',
          MNR_DEV: development ? '1' : '0',
          MNR_UI_TEST_RUN: packaged ? '' : basename(root),
          ...(packaged ? { LOCALAPPDATA: root } : {}),
        }),
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    let main, renderer;
    const timeout = setTimeout(() => child.kill(), 300000);
    try {
      main = await connect(19258, () => true, child);
      renderer = await connect(
        19259,
        (t) =>
          t.type === 'page' &&
          t.url.startsWith(development ? 'http://127.0.0.1:4200' : 'mnr://app'),
        child,
      );
      const e = renderer.evaluate,
        m = main.evaluate,
        call = renderer.call;
      await call('Emulation.setFocusEmulationEnabled', { enabled: true });
      await m(
        `globalThis.__electron=process.mainModule.require('electron');__electron.BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false));globalThis.__queue=[];__electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:__queue.shift()});`,
      );
      if (packaged) {
        await call('Network.enable');
        await call('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
      }
      const until = async (expr) => {
        for (let n = 0; n < 300; n++) {
          if (await e(expr)) return;
          await pause(30);
        }
        throw Error(
          'Timeout ' + expr + '\n' + (await e('document.querySelector("main")?.innerText')),
        );
      };
      const nav = async (path) => {
        await e(`location.hash=${JSON.stringify('#/' + path)}`);
        await pause(100);
      };
      const fill = async (id, value) => {
        await e(
          `(()=>{const x=document.getElementById(${JSON.stringify(id)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await pause(30);
      };
      const click = async (text) => {
        const x = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.matches(':disabled'))`;
        await until(`!!(${x})`);
        await e(`${x}.click()`);
        await pause(40);
      };
      const capture = async (label, selector) => {
        for (const [width, height] of [
          [1366, 768],
          [1000, 700],
          [640, 480],
        ])
          for (const zoom of [1, 1.25, 1.5]) {
            await call('Emulation.setDeviceMetricsOverride', {
              width: Math.round(width / zoom),
              height: Math.round(height / zoom),
              deviceScaleFactor: zoom,
              mobile: false,
            });
            await pause(80);
            assert.equal(
              await e('document.documentElement.scrollWidth<=innerWidth'),
              true,
              `${label} ${width} ${zoom}`,
            );
            if (zoom === 1 || width === 640) {
              await e(
                `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'})`,
              );
              await call('Page.bringToFront');
              await pause(80);
              const shot = await call('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
              });
              writeFileSync(
                `.cache/ui/consolidacao-estoque-${mode}-${label}-${width}-${zoom}.png`,
                Buffer.from(shot.data, 'base64'),
              );
            }
          }
        await call('Emulation.setDeviceMetricsOverride', {
          width: 1000,
          height: 700,
          deviceScaleFactor: 1,
          mobile: false,
        });
      };
      const generate = async (model, format, label, filtros) => {
        const path = join(outputs, `${++serial}-${label}-${model}.${format}`);
        await m(`__queue.push(${JSON.stringify(path)})`);
        const r = await e(
          `window.mnrApi.exportacoes.${format === 'xlsx' ? 'exportarExcel' : 'exportarPdf'}(${JSON.stringify({ modelo: model, filtros })})`,
        );
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.data.cancelado, false);
        assert(existsSync(path));
        manifest.push({
          path,
          documento: coletarDocumento(
            db,
            { modelo: model, filtros },
            () => new Date(r.data.geradoEm),
          ),
        });
      };
      const audit = async (label) => {
        const before = snapshot(db);
        db.pragma('query_only=ON');
        try {
          audits.push(
            await auditCheckpoint({
              e,
              until,
              generate,
              manifest,
              label,
              filter: { dataInicio: day, dataFim: '2026-11-30', clienteId: s.clienteId },
              saleId: s.state.sale?.id,
              expected: !s.state.sale
                ? undefined
                : ['devolucao-venda', 'pagamento-reembolso', 'estorno-reembolso'].includes(label)
                  ? {
                      commercial: 10000,
                      debt: 0,
                      pending: label === 'pagamento-reembolso' ? 5000 : 15000,
                      paid: label === 'pagamento-reembolso' ? 10000 : 0,
                    }
                  : { commercial: 30000, debt: 5000, pending: 0, paid: 0 },
            }),
          );
          assert.equal(snapshot(db), before);
          assert(reconciliarEstoque(db).consistente);
          assert(reconciliarFinanceiro(db));
          if (s.state.originalSale)
            assert.equal(
              JSON.stringify(
                db
                  .prepare('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id')
                  .all(s.state.sale.id),
              ),
              s.state.originalSale,
            );
        } finally {
          db.pragma('query_only=OFF');
        }
      };
      await until('!!window.mnrApi?.estornosEstoque&&!!document.querySelector("nav")');
      assert.equal(await e('typeof require'), 'undefined');
      assert.equal(await e('typeof process'), 'undefined');
      if (reopen) {
        assert.equal(snapshot(db), persisted);
        await audit('reopen');
        await nav(`compras/${s.state.first.id}/correcoes`);
        await until("document.querySelector('main').innerText.includes('DEV_COMPRA')");
        console.log('CONSOLIDACAO_ESTOQUE_REOPEN_OK', mode, root);
        continue;
      }
      for (const [label, run] of s.steps) {
        if (label === 'devolucao-compra') {
          await nav(`compras/${s.state.first.id}`);
          await until(
            `!!document.querySelector('a[href="#/compras/${s.state.first.id}/correcoes"]')`,
          );
          await e(
            `document.querySelector('a[href="#/compras/${s.state.first.id}/correcoes"]').click()`,
          );
          await until(
            `!!document.querySelector('a[href="#/compras/${s.state.first.id}/devolver"]')`,
          );
          await e(
            `document.querySelector('a[href="#/compras/${s.state.first.id}/devolver"]').click()`,
          );
          await until('!!document.getElementById("correcao-motivo")');
          await fill('correcao-motivo', 'Devolução integrada ao fornecedor');
          await fill('correcao-data', day);
          await click('Preencher todas as quantidades disponíveis');
          await fill('correcao-q-' + s.state.first.itens[0].id, '2');
          await until(`!!document.querySelector('#correcao-forma option[value="${s.cash}"]')`);
          await e(
            `(()=>{const x=document.getElementById('correcao-forma');x.value='${s.cash}';x.dispatchEvent(new Event('change',{bubbles:true}));})()`,
          );
          await fill('correcao-pagamento-0', '40,00');
          await click('Revisar efeitos oficiais');
          await until('!!document.getElementById("correcao-confirmar")');
          await capture('revisao-compra', '#correcao-revisao');
          const reviewText = await e('document.getElementById("correcao-revisao").innerText');
          for (const value of ['40,00', '60,00', '20,00']) assert(reviewText.includes(value));
          await click('Confirmar correção revisada');
          await click('Confirmar');
          await until("document.querySelector('main').innerText.includes('Correção confirmada')");
          s.state.returned = {
            documentoId: db
              .prepare(
                "SELECT id FROM documentos WHERE tipo='DEV_COMPRA' AND documento_origem_id=? ORDER BY id DESC",
              )
              .get(s.state.first.id).id,
          };
          await e(`document.querySelector('a[href*="/correcoes?documentoId"]').click()`);
          await until('!!document.getElementById("compra-correcao-documento")');
          assert(
            (await e('document.getElementById("compra-correcao-documento").innerText')).includes(
              'REEMBOLSO_FORNECEDOR',
            ),
          );
        } else run();
        if (label === 'ajustes-e-estornos') {
          const extra = s.stock.registrarEntrada(
            s.stockCommand({ produtoId: s.manual.id, quantidade: 1, custoTotalCentavos: 1 }),
          );
          await nav(`estoque/${s.manual.id}`);
          await until(
            `!!document.querySelector('a[href="#/estoque/${s.manual.id}/ajustes/${extra.movimentacaoId}"]')`,
          );
          await e(
            `document.querySelector('a[href="#/estoque/${s.manual.id}/ajustes/${extra.movimentacaoId}"]').click()`,
          );
          await until('!!document.getElementById("estorno-motivo")');
          await fill('estorno-motivo', 'Estorno na cadeia integrada');
          await fill('estorno-data', day);
          await click('Revisar estorno');
          await until('!!document.getElementById("estorno-confirmar")');
          await capture('revisao-ajuste', '#estorno-revisao');
          await click('Confirmar estorno revisado');
          await click('Confirmar');
          await until("document.querySelector('main').innerText.includes('Estorno confirmado')");
          await until(
            "document.querySelector('main').innerText.includes('Estornado pelo movimento')",
          );
        }
        await audit(label);
      }
      const before = snapshot(db);
      for (const operation of [
        () =>
          s.buyCorrections.revisarCancelamento({
            motivo: 'Bloqueio',
            dados: { documentoId: s.state.first.id, dataEfetiva: day },
          }),
        () =>
          s.reversals.obterAjuste({
            produtoId: s.productId,
            movimentoId: db
              .prepare(
                "SELECT id FROM movimentacoes_estoque WHERE produto_id=? AND natureza='COMPRA' LIMIT 1",
              )
              .get(s.productId).id,
          }),
      ])
        assert.throws(operation);
      assert.equal(snapshot(db), before);
      // Separate consistency check: the frozen paginated collector from the service test.
      const frozen = JSON.parse(readFileSync('.cache/4g3-snapshot-input.json', 'utf8'));
      assert(
        resolve(frozen.database).startsWith(resolve('.local-data/test') + require('node:path').sep),
      );
      for (const format of ['xlsx', 'pdf']) {
        const path = join(outputs, `${++serial}-snapshot.${format}`),
          base = '__electron.app.getAppPath()+"/dist/electron/services/exportacoes/"';
        await m(
          `(async()=>{const base=${base},doc=${JSON.stringify(frozen.documento)};const bytes=await process.mainModule.require(base+'${format === 'xlsx' ? 'xlsx' : 'pdf'}.js').${format === 'xlsx' ? 'gerarExcel' : 'gerarPdf'}(doc);await process.mainModule.require(base+'arquivos.js').salvarArquivo(${JSON.stringify(path)},${JSON.stringify(format)},bytes,[]);})()`,
        );
        manifest.push({ path, documento: frozen.documento });
      }
      persisted = snapshot(db);
      console.log('CONSOLIDACAO_ESTOQUE_UI_OK', mode, root);
    } finally {
      clearTimeout(timeout);
      main?.close();
      renderer?.close();
      child.kill();
      if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
    }
  }
  const manifestPath = join(outputs, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const python =
    process.env.MNR_TEST_PYTHON ??
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const checked = spawnSync(python, ['scripts/verify-exportacoes.py', manifestPath], {
    stdio: 'inherit',
  });
  assert.equal(checked.status, 0);
  writeFileSync(
    `.cache/4g3-${mode}-audit.json`,
    JSON.stringify(
      { root, outputs, manifest: manifestPath, audits, files: manifest.length },
      null,
      2,
    ),
  );
  console.log('CONSOLIDACAO_ESTOQUE_FILES_SURVIVE_CLOSE_OK', mode, manifest.length);
} finally {
  server?.kill();
  db.close();
}
