import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedRecebimentos } = require('../tests/helpers/recebimentos-ui-fixture.cjs');
const scenario = require('./recebimentos-scenario.cjs');
mkdirSync('.local-data/test', { recursive: true });
const isolated = mkdtempSync(resolve('.local-data/test/recebimentos-package-'));
mkdirSync(resolve(isolated, 'MNR Software/MNR Perfumes/data'), { recursive: true });
const db = await openDatabase(resolve(isolated, 'MNR Software/MNR Perfumes/data'), 'test');
const ids = seedRecebimentos(db);
async function run(reopen = false) {
  const child = spawn(
    resolve('release/win-unpacked/MNR Perfumes.exe'),
    ['--remote-debugging-port=19232'],
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
        target = (await (await fetch('http://127.0.0.1:19232/json/list')).json()).find(
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
        pending.set(id, { resolve, reject });
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
              await evaluate(
                `document.querySelector(${JSON.stringify(name === 'revisao' ? '#receber-revisao' : '[aria-label="Recebimento concluído"]')})?.scrollIntoView({block:'start'})`,
              );
              if (!(await evaluate('document.documentElement.scrollWidth<=innerWidth')))
                throw Error(`Overflow offline ${w} ${zoom}`);
              const shot = await call('Page.captureScreenshot', { format: 'png' });
              writeFileSync(
                resolve(`.cache/ui/recebimentos-offline-${name}-${w}-${zoom}.png`),
                Buffer.from(shot.data, 'base64'),
              );
            }
          await call('Emulation.clearDeviceMetricsOverride');
        },
      });
      console.log('RECEBIMENTOS_PACKAGED_OFFLINE_OK');
    } else {
      await evaluate(`location.hash='#/financeiro/vendas/${ids.main.id}'`);
      for (let n = 0; n < 200; n++) {
        if (await evaluate(`!!document.querySelector('[data-financial="saldoReceberCentavos"]')`))
          break;
        await new Promise((r) => setTimeout(r, 30));
      }
      const r = await evaluate(`window.mnrApi.financeiro.obterVenda(${ids.main.id})`);
      if (!r.ok || r.data.resumo.saldoReceberCentavos !== 0)
        throw Error('Resumo inconsistente após reabertura');
      if (r.data.resumo.recebimentosEfetivosCentavos !== 30000)
        throw Error('Recebimentos divergentes após reabertura');
      const movements = await evaluate(
        `window.mnrApi.financeiro.listarMovimentos({vendaId:${ids.main.id}})`,
      );
      if (!movements.ok || movements.data.itens.length !== 5)
        throw Error('Histórico duplicado ou ausente após reabertura');
      console.log('RECEBIMENTOS_PACKAGED_REOPEN_OK');
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

  console.log('RECEBIMENTOS_PACKAGED_PERSISTENCE_OK', isolated);
} finally {
  db.close();
}
