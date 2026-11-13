import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
import { connect, pause } from './exportacoes-cdp.mjs';
import { auditCheckpoint, auditFilteredExports } from './consolidacao-gerencial-scenario.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { cycle, command, day, clock } = require('../tests/helpers/consolidacao-fixture.cjs');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const { coletarDocumento } = require('../dist/electron/services/exportacoes/documento');
const { MODELOS_RELATORIO } = require('../dist/shared/exportacoes');
const packaged = process.argv.includes('--package'),
  development = process.argv.includes('--development'),
  consolidation = process.argv.includes('--consolidacao-gerencial');
assert(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
mkdirSync('.cache/ui', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/ui-exportacoes-'));
const directory = packaged ? join(root, 'MNR Software/MNR Perfumes/data') : join(root, 'data');
mkdirSync(directory, { recursive: true });
// Exports are outside application data/profile and installation directories.
const outputs = mkdtempSync(resolve(`.local-data/test/exports-${consolidation ? '4f4' : '4f3'}-`));
const db = await openDatabase(directory, 'test'),
  s = cycle(db);
const fin = createFinancialService(db, 'test', clock),
  cor = createCorrectionService(db, 'test', clock);
s.buy(100, 100);
const sale = s.sell();
if (consolidation) s.buy(5, 10000); // Current average now differs from the original historical cost.
fin.registrarRecebimento(
  command({
    vendaId: sale.id,
    dataEfetiva: day,
    pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 15000 }],
  }),
);
s.cat.saveProduct(
  command({
    ...s.productData,
    id: s.productId,
    nome: '=Água & Madeira "Ação" ' + 'Perfume brasileiro '.repeat(8),
    ativo: false,
    estoqueMinimo: 120,
  }),
);
s.cat.savePerson(
  'CLIENTE',
  command({ id: s.clienteId, nome: '+Cliente histórico atual inativo', ativo: false }),
);
const range = { dataInicio: '2026-11-01', dataFim: '2026-11-30' },
  manifest = [],
  audits = [];
const originalItems = JSON.stringify(
  db.prepare('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id').all(sale.id),
);
let server,
  serial = 0;
try {
  if (development) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      env: environment(),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    let ready = false;
    for (let n = 0; n < 120; n++) {
      try {
        if ((await fetch('http://127.0.0.1:4200')).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await pause(500);
    }
    assert(ready);
  }
  for (const reopen of [false, true]) {
    const child = spawn(
      packaged ? resolve('release/win-unpacked/MNR Perfumes.exe') : electron,
      [...(packaged ? [] : ['.']), '--inspect=19238', '--remote-debugging-port=19239'],
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
    const timer = setTimeout(() => child.kill(), 300000);
    try {
      main = await connect(19238, () => true, child);
      renderer = await connect(
        19239,
        (t) =>
          t.type === 'page' &&
          t.url.startsWith(development ? 'http://127.0.0.1:4200' : 'mnr://app'),
        child,
      );
      const e = renderer.evaluate,
        m = main.evaluate;
      await m(
        `globalThis.__mnrOriginalSave=process.mainModule.require('electron').dialog.showSaveDialog`,
      );
      await m(
        `globalThis.__mnrElectron=process.mainModule.require('electron');globalThis.__mnrSaveQueue=[];globalThis.__mnrSaveCalls=[];__mnrElectron.dialog.showSaveDialog=async(w,options)=>{__mnrSaveCalls.push(options);const next=__mnrSaveQueue.shift();if(next?.delay)await new Promise(r=>setTimeout(r,next.delay));return next?.path?{canceled:false,filePath:next.path}:{canceled:true};};__mnrElectron.BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false));`,
      );
      if (packaged) {
        await renderer.call('Network.enable');
        await renderer.call('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
      }
      const until = async (expression) => {
        for (let n = 0; n < 300; n++) {
          if (await e(expression)) return;
          await pause(30);
        }
        throw Error(
          'Export UI timeout ' +
            expression +
            '\n' +
            (await e('document.querySelector("main")?.innerText')),
        );
      };
      await until('!!window.mnrApi?.exportacoes&&!!document.querySelector("nav")');
      assert.equal(await e('typeof require'), 'undefined');
      assert.equal(await e('typeof process'), 'undefined');
      const captureScreenshot = async (label) => {
        console.log('EXPORT_SCREENSHOT_START', label);
        await renderer.call('Emulation.setFocusEmulationEnabled', { enabled: true });
        await renderer.call('Page.bringToFront');
        await e('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        const shot = await renderer.call('Page.captureScreenshot', {
          captureBeyondViewport: false,
          fromSurface: false,
        });
        console.log('EXPORT_SCREENSHOT_OK', label);
        return shot;
      };
      const before = snapshot(db);
      const generate = async (modelo, format, label, filterOverride) => {
        const filtros =
          filterOverride ?? (['CONTAS', 'REEMBOLSOS', 'ESTOQUE'].includes(modelo) ? {} : range);
        const path = join(outputs, `${++serial}-${label}-${modelo}.${format}`);
        await m(`__mnrSaveQueue.push({path:${JSON.stringify(path)}})`);
        const started = performance.now();
        const result = await e(
          `window.mnrApi.exportacoes.${format === 'xlsx' ? 'exportarExcel' : 'exportarPdf'}(${JSON.stringify({ modelo, filtros })})`,
        );
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.data.cancelado, false);
        assert.equal(result.data.nome, basename(path));
        assert(!JSON.stringify(result).includes(outputs));
        assert(existsSync(path));
        const documento = coletarDocumento(
          db,
          { modelo, filtros },
          () => new Date(result.data.geradoEm),
        );
        manifest.push({ path, documento, ms: performance.now() - started });
        assert.equal(result.data.registros, documento.registros);
        return result;
      };
      const audit = async (label, expected, filter = { ...range, clienteId: s.clienteId }) => {
        const initial = snapshot(db);
        db.pragma('query_only=ON');
        try {
          audits.push(
            await auditCheckpoint({
              e,
              until,
              generate,
              manifest,
              label,
              filter,
              expected,
              saleId: sale.id,
              capture: async (label) => {
                await e(
                  `document.getElementById('${label === 'rankings-empate' ? 'dashboard-products-title' : 'dashboard-commercial-title'}').scrollIntoView({block:'start'})`,
                );
                const shot = await captureScreenshot(`gerencial-${label}`);
                writeFileSync(
                  `.cache/ui/gerencial-${packaged ? 'package' : development ? 'http' : 'local'}-${label}.png`,
                  Buffer.from(shot.data, 'base64'),
                );
              },
            }),
          );
          assert.equal(snapshot(db), initial, 'Queries/exports wrote at ' + label);
          assert.equal(
            JSON.stringify(
              db
                .prepare('SELECT * FROM itens_documento WHERE documento_id=? ORDER BY id')
                .all(sale.id),
            ),
            originalItems,
            'Original historical items changed',
          );
        } finally {
          db.pragma('query_only=OFF');
        }
      };
      if (!reopen) {
        if (consolidation) {
          const frozen = JSON.parse(readFileSync('.cache/4f4-snapshot-input.json', 'utf8'));
          assert(
            frozen.database.startsWith(resolve('.local-data/test') + require('node:path').sep),
          );
          const Database = require('better-sqlite3');
          const isolated = new Database(frozen.database, { readonly: true, fileMustExist: true });
          const originalSnapshot = snapshot(isolated);
          const service = require('../dist/electron/services/relatorios').createReportService(
            isolated,
          );
          assert.equal(
            service.listarContasReceber({}).totais.exigivelCentavos,
            frozen.exigivelDepois,
          );
          for (const format of ['xlsx', 'pdf']) {
            const path = join(outputs, `${++serial}-4f4-snapshot.${format}`);
            await m(
              `(async()=>{const base=__mnrElectron.app.getAppPath()+'/dist/electron/services/exportacoes/';const doc=${JSON.stringify(frozen.documento)};const bytes=await process.mainModule.require(base+${JSON.stringify(format === 'xlsx' ? 'xlsx.js' : 'pdf.js')}).${format === 'xlsx' ? 'gerarExcel' : 'gerarPdf'}(doc);await process.mainModule.require(base+'arquivos.js').salvarArquivo(${JSON.stringify(path)},${JSON.stringify(format)},bytes,[__mnrElectron.app.getPath('userData')]);})()`,
            );
            manifest.push({ path, documento: frozen.documento });
          }
          assert.equal(snapshot(isolated), originalSnapshot);
          isolated.close();
          audits.push({
            label: 'snapshot-concorrente',
            during: frozen.exigivelDurante,
            after: frozen.exigivelDepois,
            files: manifest.slice(-2).map((f) => f.path),
          });
        }
        if (process.argv.includes('--native-dialog')) {
          await m(
            `globalThis.__mnrDialogMock=__mnrElectron.dialog.showSaveDialog;__mnrElectron.dialog.showSaveDialog=__mnrOriginalSave;`,
          );
          console.log('NATIVE_DIALOG_CANCEL_PENDING');
          const canceled = await e(
            `window.mnrApi.exportacoes.exportarPdf({modelo:'GERENCIAL',filtros:${JSON.stringify(range)}})`,
          );
          assert.deepEqual(canceled, { ok: true, data: { cancelado: true } });
          const path = join(outputs, `${++serial}-native.xlsx`);
          console.log('NATIVE_DIALOG_SAVE_PENDING', path);
          const result = await e(
            `window.mnrApi.exportacoes.exportarExcel({modelo:'GERENCIAL',filtros:${JSON.stringify(range)}})`,
          );
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(result.data.nome, basename(path));
          manifest.push({
            path,
            documento: coletarDocumento(
              db,
              { modelo: 'GERENCIAL', filtros: range },
              () => new Date(result.data.geradoEm),
            ),
          });
          await m(`__mnrElectron.dialog.showSaveDialog=__mnrDialogMock`);
          console.log('NATIVE_DIALOG_CANCEL_AND_SAVE_OK');
        }
        if (consolidation)
          await audit('catalogo', { commercial: 30000, debt: 5000, pending: 0, paid: 0 });
        else
          for (const modelo of MODELOS_RELATORIO)
            for (const f of ['xlsx', 'pdf']) await generate(modelo.id, f, 'catalogo');
        for (const stage of ['devolucao', 'pagamento', 'estorno-pagamento', 'estorno-devolucao']) {
          if (stage === 'devolucao') {
            globalThis.returned = cor.devolverVenda(
              command({
                documentoId: sale.id,
                dataEfetiva: '2026-11-02',
                itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
              }),
            );
            globalThis.refund = s.q.obterDocumento({
              vendaId: sale.id,
              documentoId: returned.documentoId,
            }).reembolsoIds[0];
          }
          if (stage === 'pagamento')
            globalThis.payment = fin.pagarReembolso(
              command({
                reembolsoId: refund,
                dataEfetiva: '2026-11-03',
                pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 10000 }],
              }),
            );
          if (stage === 'estorno-pagamento')
            fin.estornarReembolso(
              command({ movimentoId: payment.movimentos[0], dataEfetiva: '2026-11-04' }),
            );
          if (stage === 'estorno-devolucao')
            cor.estornarDevolucao(
              command({ documentoId: returned.documentoId, dataEfetiva: '2026-11-05' }),
            );
          if (consolidation) {
            const expected =
              stage === 'estorno-devolucao'
                ? { commercial: 30000, debt: 5000, pending: 0, paid: 0 }
                : {
                    commercial: 10000,
                    debt: 0,
                    pending: stage === 'pagamento' ? 5000 : 15000,
                    paid: stage === 'pagamento' ? 10000 : 0,
                  };
            await audit(stage, expected);
            if (stage === 'devolucao') {
              await audit('fluxo-negativo', undefined, {
                dataInicio: '2026-11-02',
                dataFim: '2026-11-02',
                clienteId: s.clienteId,
              });
              await audit('coorte-corrigida-depois', undefined, {
                dataInicio: day,
                dataFim: day,
                clienteId: s.clienteId,
              });
            }
          } else
            for (const modelo of ['GERENCIAL', 'REEMBOLSOS'])
              for (const f of ['xlsx', 'pdf']) await generate(modelo, f, stage);
          if (stage === 'devolucao')
            for (const f of ['xlsx', 'pdf'])
              await generate('GERENCIAL', f, 'negativo', {
                dataInicio: '2026-11-02',
                dataFim: '2026-11-02',
              });
        }
        if (consolidation) {
          const { seedRankingTies } = require('../tests/helpers/gerencial-fixture.cjs');
          const tiedSales = seedRankingTies(s);
          await audit('rankings-empate', undefined, range);
          cor.cancelarVenda(
            command({ documentoId: tiedSales.at(-1).id, dataEfetiva: '2026-11-06' }),
          );
          await audit('cancelamento', undefined, range);
          await audit('periodo-vazio', undefined, {
            dataInicio: '2025-12-31',
            dataFim: '2026-01-01',
          });
          const filteredBefore = snapshot(db);
          audits.push(
            await auditFilteredExports({
              e,
              generate,
              manifest,
              range,
              ids: { clienteId: s.clienteId, productId: s.productId, pix: s.pix },
            }),
          );
          assert.equal(snapshot(db), filteredBefore);
        }
        const readBefore = snapshot(db);
        const canceled = await e(
          `window.mnrApi.exportacoes.exportarExcel({modelo:'VENDAS',filtros:${JSON.stringify(range)}})`,
        );
        assert.deepEqual(canceled, { ok: true, data: { cancelado: true } });
        const count = readdirSync(outputs).length;
        for (const input of [
          { modelo: 'SQL', filtros: {} },
          { modelo: 'ESTOQUE', filtros: { path: 'C:/private' } },
          { modelo: 'VENDAS', filtros: { ...range, limite: 1 } },
          { modelo: 'CONTAS', filtros: { clienteId: -1 } },
        ]) {
          const r = await e(`window.mnrApi.exportacoes.exportarExcel(${JSON.stringify(input)})`);
          assert.equal(r.ok, false);
          assert.equal(r.error.code, 'VALIDATION');
        }
        assert.equal(readdirSync(outputs).length, count);
        const old = manifest[0].path,
          oldBytes = readFileSync(old);
        await m(`__mnrSaveQueue.push({path:${JSON.stringify(old)}})`);
        const repeated = await e(
          `window.mnrApi.exportacoes.exportarExcel({modelo:'GERENCIAL',filtros:${JSON.stringify(range)}})`,
        );
        assert.equal(repeated.error.code, 'EEXIST');
        assert.deepEqual(readFileSync(old), oldBytes);
        const rejected = await m(
          `(()=>{let n=0;const w=__mnrElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('${development ? 'http' : 'mnr'}'));for(const channel of ['exportacoes:excel','exportacoes:pdf'])for(const event of [{sender:{},senderFrame:w.webContents.mainFrame},{sender:w.webContents,senderFrame:null},{sender:w.webContents,senderFrame:{url:w.webContents.getURL()}}]){try{__mnrElectron.ipcMain._invokeHandlers.get(channel)(event,{modelo:'ESTOQUE',filtros:{}});}catch{n++;}}return n;})()`,
        );
        assert.equal(rejected, 6);
        await e(`document.querySelector('nav a[href="#/relatorios"]').click()`);
        await until('!!document.querySelector("#export-model")');
        const fill = async (id, value) =>
          e(
            `(()=>{const x=document.getElementById(${JSON.stringify(id)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event(x.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
          );
        const button = async (text) => {
          await until(
            `Array.from(document.querySelectorAll('mnr-relatorios button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
          );
          await e(
            `Array.from(document.querySelectorAll('mnr-relatorios button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
          );
        };
        for (const [modelo, format] of [
          ['VENDAS', 'xlsx'],
          ['VENDAS', 'pdf'],
          ['ESTOQUE', 'xlsx'],
          ['CONTAS', 'pdf'],
          ['REEMBOLSOS', 'xlsx'],
        ]) {
          await fill('export-model', modelo);
          await fill('export-format', format);
          if (modelo === 'VENDAS') {
            await fill('export-start', range.dataInicio);
            await fill('export-end', range.dataFim);
          }
          await button('Revisar critérios');
          await until('document.activeElement.id==="export-review-title"');
          if (modelo === 'VENDAS' && format === 'xlsx') {
            await e(
              `document.getElementById('export-review-title').scrollIntoView({block:'start'})`,
            );
            const capture = await captureScreenshot('export-review');
            writeFileSync(
              `.cache/ui/exportacoes-${packaged ? 'package' : development ? 'http' : 'local'}-revisao.png`,
              Buffer.from(capture.data, 'base64'),
            );
          }
          const path = join(outputs, `${++serial}-UI-${modelo}.${format}`);
          await m(`__mnrSaveQueue.push({path:${JSON.stringify(path)},delay:300})`);
          await button('Escolher destino e gerar');
          await until('document.querySelector("fieldset").disabled');
          const busy = await e(
            `window.mnrApi.exportacoes.exportarExcel({modelo:'ESTOQUE',filtros:{}})`,
          );
          assert.equal(busy.error.code, 'EXPORT_BUSY');
          await until(
            'document.querySelector("#export-result").textContent.includes("Relatório salvo")',
          );
          manifest.push({
            path,
            documento: coletarDocumento(
              db,
              { modelo, filtros: modelo === 'VENDAS' ? range : {} },
              () => new Date(),
            ),
          });
        }
        await fill('export-model', 'VENDAS');
        await fill('export-start', '2026-12-01');
        await fill('export-end', '2026-11-01');
        await button('Revisar critérios');
        await until(
          'document.querySelector("#export-result").textContent.includes("período válido")',
        );
        await fill('export-start', '2025-01-01');
        await fill('export-end', '2025-01-02');
        await button('Revisar critérios');
        await button('Escolher destino e gerar');
        await until(
          'document.querySelector("#export-result").textContent.includes("Salvamento cancelado")',
        );
        const emptyPath = join(outputs, `${++serial}-empty.pdf`);
        await m(`__mnrSaveQueue.push({path:${JSON.stringify(emptyPath)}})`);
        await fill('export-format', 'pdf');
        await button('Revisar critérios');
        await button('Escolher destino e gerar');
        await until(
          'document.querySelector("#export-result").textContent.includes("Relatório salvo")',
        );
        manifest.push({
          path: emptyPath,
          documento: coletarDocumento(
            db,
            { modelo: 'VENDAS', filtros: { dataInicio: '2025-01-01', dataFim: '2025-01-02' } },
            () => new Date(),
          ),
        });
        await e(`document.querySelector('main').scrollTop=0`);
        for (const [width, height] of [
          [1366, 768],
          [1000, 700],
          [640, 480],
        ])
          for (const zoom of [1, 1.25, 1.5]) {
            await renderer.call('Emulation.setDeviceMetricsOverride', {
              width: Math.floor((width - 16) / zoom),
              height: Math.floor((height - 39) / zoom),
              deviceScaleFactor: zoom,
              mobile: false,
            });
            assert(
              await e(
                'document.documentElement.scrollWidth<=innerWidth&&document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth+1',
              ),
            );
            const shot = await captureScreenshot(`export-${width}-${zoom}`);
            writeFileSync(
              `.cache/ui/exportacoes-${packaged ? 'package' : development ? 'http' : 'local'}-${width}-${zoom}.png`,
              Buffer.from(shot.data, 'base64'),
            );
          }
        await renderer.call('Emulation.clearDeviceMetricsOverride');
        const key = async (key, modifiers = 0) => {
          await renderer.call('Page.bringToFront');
          await renderer.call('Emulation.setFocusEmulationEnabled', { enabled: true });
          const windowsVirtualKeyCode = { Tab: 9, Enter: 13, Escape: 27 }[key];
          await renderer.call('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key,
            code: key,
            modifiers,
            windowsVirtualKeyCode,
            ...(key === 'Enter' ? { text: '\r' } : {}),
          });
          await renderer.call('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key,
            code: key,
            modifiers,
            windowsVirtualKeyCode,
          });
          await pause(60);
        };
        await e(`document.getElementById('export-format').focus()`);
        await key('Tab');
        assert.equal(await e('document.activeElement.id'), 'export-start');
        await key('Tab', 8);
        assert.equal(await e('document.activeElement.id'), 'export-format');
        assert.equal(await e('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
        await key('Escape');
        assert.equal(await e('document.getElementById("export-start").value'), '2025-01-01');
        await e(
          `Array.from(document.querySelectorAll('mnr-relatorios button')).find(b=>b.textContent.trim()==='Revisar critérios').focus()`,
        );
        await key('Enter');
        await until('document.activeElement.id==="export-review-title"');
        await e(`document.querySelector('nav a[href="#/dashboard"]').click()`);
        await until('!!document.querySelector("[data-dashboard-ready]")');
        await e(`document.querySelector('mnr-dashboard a[href^="#/relatorios"]').click()`);
        await until('!!document.getElementById("export-start")');
        assert(
          await e(
            'document.querySelector("mnr-relatorios").innerText.includes("recebidos do Dashboard")',
          ),
        );
        await fill('export-model', 'ESTOQUE');
        assert.equal(await e('document.getElementById("export-start")'), null);
        assert.equal(snapshot(db), readBefore);
      } else {
        if (consolidation) await audit('reopen', undefined, range);
        else for (const f of ['xlsx', 'pdf']) await generate('GERENCIAL', f, 'reopen');
        assert.equal(snapshot(db), before);
      }
      console.log(
        'EXPORTACOES_ENV_OK',
        packaged ? 'package-offline' : development ? 'http' : 'mnr',
        reopen ? 'reopen' : 'first',
      );
    } finally {
      clearTimeout(timer);
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
  assert.equal(
    checked.status,
    0,
    'Independent file readers failed; set MNR_TEST_PYTHON with pypdf/pdfplumber/openpyxl installed.',
  );
  writeFileSync(
    `.cache/${consolidation ? '4f4' : '4f3'}-${packaged ? 'package' : development ? 'http' : 'local'}-exports.json`,
    JSON.stringify(
      {
        root,
        outputs,
        manifest: manifestPath,
        files: manifest.length,
        ...(consolidation ? { audits } : {}),
      },
      null,
      2,
    ),
  );
  console.log('EXPORTACOES_FILES_SURVIVE_CLOSE_OK', manifest.length, outputs);
} finally {
  server?.kill();
  db.close();
}
