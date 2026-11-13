// Actual renderer/preload/IPC; debugger fault injection exists only in this test process.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
import { connect, pause } from './exportacoes-cdp.mjs';
import { money } from './consolidacao-gerencial-scenario.mjs';
const require = createRequire(import.meta.url),
  { openDatabase } = require('../dist/electron/infrastructure/database'),
  { seedComprasCorrecoes } = require('../tests/helpers/correcoes-compras-fixture.cjs'),
  { createStockService } = require('../dist/electron/services/estoque'),
  { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs'),
  { coletarDocumento } = require('../dist/electron/services/exportacoes/documento');
const packaged = process.argv.includes('--package'),
  development = process.argv.includes('--development');
assert(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
mkdirSync('.cache/ui', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/ui-estornos-estoque-')),
  directory = packaged ? join(root, 'MNR Software/MNR Perfumes/data') : join(root, 'data'),
  outputs = mkdtempSync(resolve('.local-data/test/exports-4g2-'));
mkdirSync(directory, { recursive: true });
const db = await openDatabase(directory, 'test'),
  s = seedComprasCorrecoes(db),
  stock = createStockService(db, 'test');
const stockCommand = (dados) => ({
  operacaoId: crypto.randomUUID(),
  motivo: 'Fixture isolada de estoque',
  dataEfetiva: '2026-11-01',
  dados,
});
stock.registrarEntrada(
  stockCommand({ produtoId: s.product.id, quantidade: 10, custoTotalCentavos: 1000 }),
);
let server, persisted, adjustment;
const manifest = [];
let serial = 0;
try {
  if (development) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: environment(),
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
      [...(packaged ? [] : ['.']), '--inspect=19248', '--remote-debugging-port=19249'],
      {
        cwd: packaged ? root : process.cwd(),
        stdio: ['ignore', 'ignore', 'inherit'],
        env: environment({
          MNR_SMOKE: '0',
          MNR_DEV: development ? '1' : '0',
          MNR_UI_TEST_RUN: packaged ? '' : basename(root),
          ...(packaged ? { LOCALAPPDATA: root } : {}),
        }),
      },
    );
    let main, renderer;
    const timeout = setTimeout(() => child.kill(), 180000);
    try {
      main = await connect(19248, () => true, child);
      renderer = await connect(
        19249,
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
        for (let n = 0; n < 220; n++) {
          if (await e(expr)) return;
          await pause(30);
        }
        throw Error(
          'Timeout ' + expr + '\n' + (await e('document.querySelector("main")?.innerText')),
        );
      };
      const click = async (label) => {
        const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.matches(':disabled'))`;
        await until(`!!(${expr})`);
        await e(`${expr}.click()`);
        await pause(40);
      };
      const fill = async (id, value) => {
        await e(
          `(()=>{const x=document.getElementById(${JSON.stringify(id)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await pause(30);
      };
      const nav = async (path) => {
        await e(`location.hash=${JSON.stringify('#/' + path)}`);
        await pause(100);
      };
      const api = async (method, input) => {
        const r = await e(`window.mnrApi.estornosEstoque.${method}(${JSON.stringify(input)})`);
        assert.equal(r.ok, true, JSON.stringify(r));
        return r.data;
      };
      const capture = async (name) => {
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
              `${name} ${width} ${zoom}`,
            );
            if (zoom === 1 || width === 640) {
              await call('Page.bringToFront');
              await e(
                `document.querySelector(${JSON.stringify(name === 'revisao' ? '#estorno-revisao' : name === 'resultado' ? '[aria-label="Estorno registrado"]' : 'mnr-estorno-estoque h2')})?.scrollIntoView({block:'start'})`,
              );
              await pause(80);
              const img = await call('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
              });
              writeFileSync(
                resolve(
                  `.cache/ui/estornos-estoque-${packaged ? 'offline' : development ? 'http' : 'local'}-${name}-${width}-${zoom}.png`,
                ),
                Buffer.from(img.data, 'base64'),
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
      const checkpoint = async (label) => {
        const before = snapshot(db);
        db.pragma('query_only=ON');
        try {
          const res = await e(
              `window.mnrApi.relatorios.obterResumoEstoque({dataInicio:'2026-11-01',dataFim:'2026-11-30'})`,
            ),
            g = await e(
              `window.mnrApi.relatorios.obterResumoGerencial({dataInicio:'2026-11-01',dataFim:'2026-11-30'})`,
            );
          assert(res.ok);
          assert(g.ok);
          const balance = stock.consultarSaldo(s.product.id);
          const flows = db
            .prepare(
              "SELECT natureza,count(*) AS movimentos,sum(quantidade_delta) AS quantidadeDelta,sum(valor_delta_centavos) AS valorDeltaCentavos FROM movimentacoes_estoque WHERE data_efetiva BETWEEN '2026-11-01' AND '2026-11-30' GROUP BY natureza ORDER BY natureza",
            )
            .all();
          const normalizeFlows = (rows) =>
            rows
              .map((r) => ({
                ...r,
                quantidadeDelta: BigInt(r.quantidadeDelta).toString(),
                valorDeltaCentavos: BigInt(r.valorDeltaCentavos).toString(),
              }))
              .sort((a, b) => a.natureza.localeCompare(b.natureza));
          assert.deepEqual(normalizeFlows(res.data.movimentosPeriodo), normalizeFlows(flows));
          assert.equal(res.data.posicaoAtual.unidades, balance.quantidade);
          assert.equal(res.data.posicaoAtual.valorCentavos, balance.valorTotalCentavos);
          assert.equal(g.data.fluxoFinanceiro.recebidoLiquidoCentavos, 0);
          assert.equal(g.data.fluxoComercial.faturamentoLiquidoCentavos, 0);
          await nav('dashboard');
          await until('!!document.querySelector("[data-dashboard-ready]")');
          const values = await e(
              `Object.fromEntries(Array.from(document.querySelectorAll('[data-metric]')).map(x=>[x.dataset.metric,x.textContent.trim()]))`,
            ),
            p = res.data.posicaoAtual;
          assert.equal(values['stock-value'], money(p.valorCentavos).replace('−', '-'));
          assert.equal(values['stock-units'], String(p.unidades));
          assert.equal(values['stock-empty'], String(p.semEstoque));
          assert.equal(values['stock-low'], String(p.abaixoMinimo));
          for (const format of ['xlsx', 'pdf']) {
            const path = join(outputs, `${++serial}-${label}.${format}`);
            await m(`__queue.push(${JSON.stringify(path)})`);
            const result = await e(
              `window.mnrApi.exportacoes.${format === 'xlsx' ? 'exportarExcel' : 'exportarPdf'}({modelo:'ESTOQUE',filtros:{}})`,
            );
            assert.equal(result.ok, true, JSON.stringify(result));
            assert.equal(result.data.cancelado, false);
            assert(existsSync(path));
            manifest.push({
              path,
              documento: coletarDocumento(
                db,
                { modelo: 'ESTOQUE', filtros: {} },
                () => new Date(result.data.geradoEm),
              ),
            });
          }
          assert.equal(snapshot(db), before);
          console.log('ESTORNOS_ESTOQUE_CHECKPOINT_OK', label, JSON.stringify(p));
        } finally {
          db.pragma('query_only=OFF');
        }
      };
      await until('!!window.mnrApi?.estornosEstoque&&!!document.querySelector("nav")');
      assert.equal(await e('typeof require'), 'undefined');
      assert.equal(await e('typeof process'), 'undefined');
      if (reopen) {
        assert.equal(snapshot(db), persisted);
        const before = snapshot(db),
          d = await api('obterAjuste', { produtoId: s.product.id, movimentoId: adjustment });
        assert.equal(d.elegivel, false);
        assert(d.estorno);
        await nav(`estoque/${s.product.id}/ajustes/${adjustment}`);
        await until(
          "document.querySelector('main').innerText.includes('Estornado pelo movimento')",
        );
        assert.equal(await e('!!document.getElementById("estorno-revisar")'), false);
        assert.equal(snapshot(db), before);
        await checkpoint('reopen');
        console.log('ESTORNOS_ESTOQUE_REOPEN_OK', root);
        continue;
      }
      await checkpoint('antes');
      // Exercise the existing physical count form, not an alternate renderer.
      await nav(`estoque/${s.product.id}`);
      await click('Contagem física');
      await fill('estoque-quantidade', '15');
      await fill('estoque-custo', '0,05');
      await fill('estoque-motivo', 'Contagem física de teste');
      await click('Revisar operação');
      await until('!!document.querySelector("dialog[open]")');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('Operação concluída')");
      adjustment = db
        .prepare(
          "SELECT id FROM movimentacoes_estoque WHERE produto_id=? AND natureza='AJUSTE_ENTRADA' ORDER BY id DESC LIMIT 1",
        )
        .get(s.product.id).id;
      await until(
        `!!document.querySelector('a[href="#/estoque/${s.product.id}/ajustes/${adjustment}"]')`,
      );
      await e(
        `document.querySelector('a[href="#/estoque/${s.product.id}/ajustes/${adjustment}"]').click()`,
      );
      await until('!!document.getElementById("estorno-motivo")');
      await click('Revisar estorno');
      await until(
        "document.getElementById('estorno-motivo').getAttribute('aria-invalid')==='true'",
      );
      await fill('estorno-motivo', 'Desfazer divergência registrada');
      await capture('formulario');
      await click('Revisar estorno');
      await until('!!document.getElementById("estorno-revisao")');
      await capture('revisao');
      await e(`document.querySelector('#estorno-confirmar button').focus()`);
      for (const modifiers of [0, 8]) {
        await call('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          modifiers,
        });
        await call('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Tab',
          code: 'Tab',
          windowsVirtualKeyCode: 9,
          modifiers,
        });
        assert.equal(await e('document.activeElement!==document.body'), true);
      }
      await e(`document.querySelector('#estorno-confirmar button').focus()`);
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        windowsVirtualKeyCode: 13,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await until('!!document.querySelector("dialog[open]")');
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await until('!document.querySelector("dialog[open]")');
      assert.equal(
        await e(`document.activeElement===document.querySelector('#estorno-confirmar button')`),
        true,
      );
      if (!packaged)
        await m(
          `globalThis.__commands=[];globalThis.__lost=true;const ipc=__electron.ipcMain;globalThis.__originalWrite=ipc._invokeHandlers.get('estornos-estoque:estornar');ipc.removeHandler('estornos-estoque:estornar');ipc.handle('estornos-estoque:estornar',async(event,command)=>{__commands.push(JSON.stringify(command));const r=await __originalWrite(event,command);if(__lost&&r.ok){__lost=false;throw Error('Test lost stock reversal response AFTER commit');}return r;});`,
        );
      await click('Confirmar estorno revisado');
      await e(
        `(()=>{const b=Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar');b.click();b.click();})()`,
      );
      if (!packaged) {
        await until(
          "document.querySelector('main').innerText.includes('Repetir a mesma intenção')",
        );
        await nav('dashboard');
        assert.equal(await e('location.hash'), `#/estoque/${s.product.id}/ajustes/${adjustment}`);
        await click('Repetir a mesma intenção');
        const sent = await m('__commands');
        assert.equal(sent.length, 2);
        assert.equal(sent[0], sent[1]);
      }
      await until("document.querySelector('main').innerText.includes('Estorno confirmado')");
      await until("document.querySelector('main').innerText.includes('Estornado pelo movimento')");
      await capture('resultado');
      assert.equal(stock.consultarSaldo(s.product.id).quantidade, 10);
      assert.equal(stock.consultarSaldo(s.product.id).valorTotalCentavos, 1000);
      await checkpoint('apos-positivo');
      // Negative adjustment returns its exact historical value; lost refresh does not repeat a write.
      const loss = stock.registrarPerda(stockCommand({ produtoId: s.product.id, quantidade: 4 }));
      await nav(`estoque/${s.product.id}/ajustes/${loss.movimentacaoId}`);
      await until('!!document.getElementById("estorno-motivo")');
      await fill('estorno-motivo', 'Estornar perda de teste');
      await click('Revisar estorno');
      await until('!!document.getElementById("estorno-confirmar")');
      if (!packaged)
        await m(
          `(()=>{globalThis.__failContext=false;const ipc=__electron.ipcMain;globalThis.__originalContext=ipc._invokeHandlers.get('estornos-estoque:obter-ajuste');ipc.removeHandler('estornos-estoque:obter-ajuste');ipc.handle('estornos-estoque:obter-ajuste',(...args)=>{if(__failContext){__failContext=false;return {ok:false,error:{code:'INTERNAL_ERROR',message:'Test read failed after success'}};}return __originalContext(...args);});__failContext=true;})()`,
        );
      await click('Confirmar estorno revisado');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('Estorno confirmado')");
      if (!packaged) {
        await until("document.querySelector('main').innerText.includes('Falhou somente')");
        await click('Consultar novamente preservando campos');
        await until('!document.querySelector("[role=alert]")');
      }
      assert.equal(stock.consultarSaldo(s.product.id).valorTotalCentavos, 1000);
      await checkpoint('apos-negativo');
      // Another official stock operation invalidates the print before any reversal is written.
      const stale = stock.registrarEntrada(
        stockCommand({ produtoId: s.product.id, quantidade: 1, custoTotalCentavos: 1 }),
      );
      await nav(`estoque/${s.product.id}/ajustes/${stale.movimentacaoId}`);
      await until('!!document.getElementById("estorno-motivo")');
      await fill('estorno-motivo', 'Preservar motivo após conflito');
      await click('Revisar estorno');
      await until('!!document.getElementById("estorno-confirmar")');
      stock.registrarSaida(stockCommand({ produtoId: s.product.id, quantidade: 1 }));
      await click('Confirmar estorno revisado');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('mudou')");
      assert.equal(
        await e('document.getElementById("estorno-motivo").value'),
        'Preservar motivo após conflito',
      );
      await click('Consultar novamente preservando campos');
      await until("document.querySelector('main').innerText.includes('movimentação posterior')");
      assert.equal(await e('!!document.getElementById("estorno-revisar")'), false);
      // User leaves this definitively blocked form only after explicit discard of its reason.
      await nav(`estoque/${s.product.id}/ajustes/${adjustment}`);
      await until('!!document.querySelector("dialog[open]")');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('Estornado pelo movimento')");
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
      assert.equal(db.prepare('SELECT count(*) n FROM movimentos_financeiros').get().n, 0);
      persisted = snapshot(db);
      console.log(
        'ESTORNOS_ESTOQUE_UI_OK',
        packaged ? 'package-offline' : development ? 'http' : 'mnr',
        root,
      );
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
  const r = spawnSync(python, ['scripts/verify-exportacoes.py', manifestPath], {
    stdio: 'inherit',
  });
  assert.equal(r.status, 0);
  writeFileSync(
    `.cache/4g2-${packaged ? 'package' : development ? 'http' : 'local'}-exports.json`,
    JSON.stringify({ root, outputs, manifest: manifestPath, files: manifest.length }, null, 2),
  );
  console.log('ESTORNOS_ESTOQUE_FILES_SURVIVE_CLOSE_OK', manifest.length, outputs);
} finally {
  server?.kill();
  db.close();
}
