// Real Dashboard/main/preload in local, HTTP and packaged/offline environments.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { cycle, command, clock, day } = require('../tests/helpers/consolidacao-fixture.cjs');
const { createFinancialService } = require('../dist/electron/services/financeiro');
const { createCorrectionService } = require('../dist/electron/services/correcoes');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const scenario = require('./dashboard-scenario.cjs');
const packaged = process.argv.includes('--package'),
  development = process.argv.includes('--development');
assert.ok(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/ui-dashboard-'));
const directory = packaged
  ? resolve(root, 'MNR Software/MNR Perfumes/data')
  : resolve(root, 'data');
mkdirSync(directory, { recursive: true });
const db = await openDatabase(directory, 'test');
let before = snapshot(db),
  s,
  sale,
  returned,
  receipt,
  payment,
  refund;
const ids = {};
const fin = createFinancialService(db, 'test', clock),
  cor = createCorrectionService(db, 'test', clock);
const advance = (stage) => {
  assert.equal(snapshot(db), before, 'Dashboard queries wrote to database before ' + stage);
  switch (stage) {
    case 'entry':
      s = cycle(db);
      s.buy(20, 100);
      sale = s.sell();
      Object.assign(ids, { saleId: sale.id, clienteId: s.clienteId, productId: s.productId });
      break;
    case 'receipt':
      receipt = fin.registrarRecebimento(
        command({
          vendaId: sale.id,
          dataEfetiva: day,
          pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 15000 }],
        }),
      );
      break;
    case 'return':
      s.buy(5, 10000);
      returned = cor.devolverVenda(
        command({
          documentoId: sale.id,
          dataEfetiva: '2026-11-02',
          itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 1 }],
        }),
      );
      refund = s.q.obterDocumento({ vendaId: sale.id, documentoId: returned.documentoId })
        .reembolsoIds[0];
      break;
    case 'payment':
      payment = fin.pagarReembolso(
        command({
          reembolsoId: refund,
          dataEfetiva: '2026-11-03',
          pagamentos: [{ formaPagamentoId: s.pix, valorCentavos: 10000 }],
        }),
      );
      break;
    case 'undo-payment':
      fin.estornarReembolso(
        command({ movimentoId: payment.movimentos[0], dataEfetiva: '2026-11-04' }),
      );
      break;
    case 'undo-return':
      cor.estornarDevolucao(
        command({ documentoId: returned.documentoId, dataEfetiva: '2026-11-04' }),
      );
      break;
    case 'undo-receipt':
      fin.estornarRecebimento(
        command({ movimentoId: receipt.movimentos[0], dataEfetiva: '2026-11-05' }),
      );
      break;
    case 'modalities':
      s.sell('cash');
      s.sell('credit');
      break;
    case 'inactive':
      s.cat.saveProduct(
        command({
          ...s.productData,
          id: s.productId,
          nome: 'Nome atual inativo',
          ativo: false,
          estoqueMinimo: 100,
        }),
      );
      s.cat.savePerson(
        'CLIENTE',
        command({ id: s.clienteId, nome: 'Cliente atual inativo', ativo: false }),
      );
      break;
    default:
      throw Error(stage);
  }
  before = snapshot(db);
};
mkdirSync('.cache/dashboard-app', { recursive: true });
writeFileSync(
  '.cache/dashboard-app/package.json',
  JSON.stringify({
    name: 'mnr-dashboard-test',
    version: '0.1.0',
    main: '../../scripts/dashboard-test-main.cjs',
  }),
);
const faultFile = resolve(root, 'dashboard-fault.json');
let server;
try {
  if (development) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: environment(),
    });
    let ready = false;
    for (let n = 0; n < 120; n++) {
      if (server.exitCode !== null) throw Error('Servidor encerrou');
      try {
        if ((await fetch('http://127.0.0.1:4200')).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw Error('Servidor indisponível');
  }
  for (const reopen of [false, true]) {
    const child = spawn(
      packaged ? resolve('release/win-unpacked/MNR Perfumes.exe') : electron,
      [...(packaged ? [] : ['.cache/dashboard-app']), '--remote-debugging-port=19236'],
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
    let socket;
    const timeout = setTimeout(() => child.kill(), 180000);
    try {
      let target;
      for (let n = 0; n < 200; n++) {
        if (child.exitCode !== null) throw Error('Electron encerrou');
        try {
          target = (await (await fetch('http://127.0.0.1:19236/json/list')).json()).find(
            (t) =>
              t.type === 'page' &&
              t.url.startsWith(development ? 'http://127.0.0.1:4200' : 'mnr://app'),
          );
          if (target) break;
        } catch {
          /* startup */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!target) throw Error('CDP indisponível');
      socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        socket.onopen = res;
        socket.onerror = rej;
      });
      let seq = 0;
      const pending = new Map();
      socket.onmessage = (e) => {
        const m = JSON.parse(e.data),
          p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
        }
      };
      socket.onclose = () => {
        for (const p of pending.values()) p.reject(Error('CDP encerrado'));
        pending.clear();
      };
      const call = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = ++seq,
            timer = setTimeout(() => {
              pending.delete(id);
              rej(Error('CDP timeout ' + method));
            }, 15000);
          pending.set(id, {
            resolve: (x) => {
              clearTimeout(timer);
              res(x);
            },
            reject: (e) => {
              clearTimeout(timer);
              rej(e);
            },
          });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const r = await call('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      if (packaged) {
        await call('Network.enable');
        await call('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
      }
      let ready = false;
      for (let n = 0; n < 200; n++) {
        if (await evaluate('!!window.mnrApi?.relatorios&&!!document.querySelector("nav")')) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(ready, true);
      const key = async (key, modifiers = 0) => {
        await call('Page.bringToFront');
        await call('Emulation.setFocusEmulationEnabled', { enabled: true });
        const windowsVirtualKeyCode = { Tab: 9, Enter: 13, Escape: 27 }[key];
        await call('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          code: key,
          modifiers,
          windowsVirtualKeyCode,
          ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
        });
        await call('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          code: key,
          modifiers,
          windowsVirtualKeyCode,
        });
        await new Promise((r) => setTimeout(r, 60));
      };
      const capture = async (name, matrix = false) => {
        mkdirSync('.cache/ui', { recursive: true });
        for (const [width, height] of matrix
          ? [
              [1366, 768],
              [1000, 700],
              [640, 480],
            ]
          : [[1366, 768]]) {
          for (const zoom of matrix ? [1, 1.25, 1.5] : [1]) {
            await call('Emulation.setDeviceMetricsOverride', {
              width: Math.floor((width - 16) / zoom),
              height: Math.floor((height - 39) / zoom),
              deviceScaleFactor: zoom,
              mobile: false,
            });
            await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
            assert.equal(
              await evaluate(
                'document.documentElement.scrollWidth <= innerWidth && document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth + 1',
              ),
              true,
              `${name} ${width} ${zoom}`,
            );
            const shot = await call('Page.captureScreenshot');
            writeFileSync(
              resolve(
                `.cache/ui/dashboard-${packaged ? 'package' : development ? 'http' : 'local'}-${name}-${width}-${zoom}.png`,
              ),
              Buffer.from(shot.data, 'base64'),
            );
          }
        }
        await call('Emulation.clearDeviceMetricsOverride');
      };
      const faults = packaged
        ? undefined
        : {
            set: (fault) => writeFileSync(faultFile, JSON.stringify(fault)),
            entered: () => existsSync(faultFile + '.entered'),
            finished: () => existsSync(faultFile + '.finished'),
          };
      await scenario({ evaluate, ids, advance, reopen, capture, key, faults });
      assert.equal(snapshot(db), before);
      console.log(
        'DASHBOARD_ENV_OK',
        packaged ? 'package-offline' : development ? 'http' : 'mnr',
        reopen ? 'reopen' : 'first',
        root,
      );
    } finally {
      clearTimeout(timeout);
      socket?.close();
      child.kill();
      if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
    }
  }
} finally {
  server?.kill();
  db.close();
}
