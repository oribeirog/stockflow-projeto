import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedCorrecoes } = require('../tests/helpers/correcoes-ui-fixture.cjs');
const scenario = require('./correcoes-scenario.cjs');
mkdirSync('.local-data/test', { recursive: true });
const isolated = mkdtempSync(resolve('.local-data/test/correcoes-package-'));
mkdirSync(resolve(isolated, 'MNR Software/MNR Perfumes/data'), { recursive: true });
const db = await openDatabase(resolve(isolated, 'MNR Software/MNR Perfumes/data'), 'test');
const ids = seedCorrecoes(db);
let stockAfter;
async function run(reopen = false) {
  const child = spawn(
    resolve('release/win-unpacked/MNR Perfumes.exe'),
    ['--remote-debugging-port=19233'],
    {
      cwd: isolated,
      env: environment({
        LOCALAPPDATA: isolated,
        MNR_SMOKE: '0',
        MNR_DEV: '0',
        MNR_UI_TEST_RUN: '',
      }),
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  let socket;
  const timeout = setTimeout(() => child.kill(), 120000);
  try {
    let target;
    for (let n = 0; n < 150; n++) {
      if (child.exitCode !== null) throw Error('Executável encerrou');
      try {
        target = (await (await fetch('http://127.0.0.1:19233/json/list')).json()).find(
          (t) => t.type === 'page' && t.url.startsWith('mnr://'),
        );
        if (target) break;
      } catch {
        /* Aguardando CDP. */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!target) throw Error('CDP indisponível');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let seq = 0;
    const pending = new Map();
    socket.onclose = () => {
      for (const p of pending.values()) p.reject(Error('CDP encerrou antes de responder.'));
      pending.clear();
    };
    socket.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
    };
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
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
      if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await call('Network.enable');
    await call('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    if (!reopen) {
      await scenario({
        evaluate,
        ids,
        keyboard: async () => {
          const key = async (key, code, virtual, modifiers = 0) => {
            await call('Input.dispatchKeyEvent', {
              type: 'keyDown',
              key,
              code,
              windowsVirtualKeyCode: virtual,
              modifiers,
              ...(key === 'Enter' ? { text: '\r' } : {}),
            });
            await call('Input.dispatchKeyEvent', {
              type: 'keyUp',
              key,
              code,
              windowsVirtualKeyCode: virtual,
              modifiers,
            });
            await new Promise((r) => setTimeout(r, 100));
          };
          await evaluate(`document.querySelector('#correcao-confirmar button').focus()`);
          await key('Tab', 'Tab', 9);
          await key('Tab', 'Tab', 9, 8);
          await evaluate(`document.querySelector('#correcao-confirmar button').focus()`);
          await key('Enter', 'Enter', 13);
          if (!(await evaluate(`!!document.querySelector('dialog[open]')`)))
            throw Error('Enter não abriu diálogo');
          await key('Escape', 'Escape', 27);
          if (
            !(await evaluate(
              `document.activeElement===document.querySelector('#correcao-confirmar button')`,
            ))
          )
            throw Error('Foco não restaurado');
        },
        capture: async (name) => {
          mkdirSync('.cache/ui', { recursive: true });
          for (const [w, h] of [
            [1366, 768],
            [1000, 700],
            [640, 480],
          ])
            for (const zoom of [1, 1.25, 1.5]) {
              await call('Emulation.setDeviceMetricsOverride', {
                width: Math.floor(w / zoom),
                height: Math.floor(h / zoom),
                deviceScaleFactor: zoom,
                mobile: false,
              });
              await new Promise((r) => setTimeout(r, 150));
              await evaluate(
                `document.querySelector(${JSON.stringify(name === 'formulario' ? '.table-wrap' : name === 'resultado' ? '[aria-label="Correção concluída"]' : '#correcao-revisao')})?.scrollIntoView({block:'start'})`,
              );
              if (!(await evaluate('document.documentElement.scrollWidth<=innerWidth')))
                throw Error(`Overflow offline ${w} ${zoom}`);
              const shot = await call('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
              });
              writeFileSync(
                resolve(`.cache/ui/correcoes-offline-${name}-${w}-${zoom}.png`),
                Buffer.from(shot.data, 'base64'),
              );
            }
          await call('Emulation.clearDeviceMetricsOverride');
        },
      });
      stockAfter = db
        .prepare('SELECT quantidade,valor_total_centavos FROM saldos_estoque WHERE produto_id=?')
        .get(ids.productId);
      console.log('CORRECOES_PACKAGED_OFFLINE_OK');
    } else {
      await evaluate(`location.hash='#/financeiro/vendas/${ids.entry.id}'`);
      for (let n = 0; n < 200; n++) {
        if (await evaluate(`!!document.querySelector('[data-financial="saldoReceberCentavos"]')`))
          break;
        await new Promise((r) => setTimeout(r, 30));
      }
      const r = await evaluate(`window.mnrApi.financeiro.obterVenda(${ids.entry.id})`);
      if (
        !r.ok ||
        r.data.resumo.reembolsosPendentesCentavos !== 15000 ||
        r.data.resumo.recebimentosEfetivosCentavos !== 25000 ||
        r.data.resumo.saldoReceberCentavos !== 0
      )
        throw Error('Resumo divergente após reabertura');
      const c = await evaluate(`window.mnrApi.correcoes.obterContextoVenda(${ids.main.id})`);
      if (!c.ok || c.data.itens[0].quantidadeDisponivel !== 0)
        throw Error('Histórico divergente após reabertura');
      const stock = await evaluate(`window.mnrApi.estoque.obter(${ids.productId})`);
      if (
        !stock.ok ||
        stock.data.quantidade !== stockAfter.quantidade ||
        stock.data.valorTotalCentavos !== stockAfter.valor_total_centavos
      )
        throw Error('Estoque divergente após reabertura');
      const docs = await evaluate(
        `window.mnrApi.correcoes.listarDocumentos({vendaId:${ids.main.id}})`,
      );
      if (!docs.ok || docs.data.itens.length !== 2)
        throw Error('Documentos duplicados ou ausentes');
      console.log('CORRECOES_PACKAGED_REOPEN_OK');
    }
  } finally {
    clearTimeout(timeout);
    socket?.close();
    child.kill();
    if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
  }
}
try {
  await run();
  await run(true);

  console.log('CORRECOES_PACKAGED_PERSISTENCE_OK', isolated);
} finally {
  db.close();
}
