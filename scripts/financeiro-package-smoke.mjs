import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedFinanceiro, snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const scenario = require('./financeiro-scenario.cjs');
mkdirSync('.local-data/test', { recursive: true });
const isolated = mkdtempSync(resolve('.local-data/test/financeiro-package-'));
mkdirSync(resolve(isolated, 'MNR Software/MNR Perfumes/data'), { recursive: true });
const db = await openDatabase(resolve(isolated, 'MNR Software/MNR Perfumes/data'), 'test');
const ids = seedFinanceiro(db),
  before = snapshot(db);
async function run(reopen = false) {
  const child = spawn(
    resolve('release/win-unpacked/MNR Perfumes.exe'),
    ['--remote-debugging-port=19231'],
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
        target = (await (await fetch('http://127.0.0.1:19231/json/list')).json()).find(
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
      await scenario({ evaluate, ids, reload: () => call('Page.reload') });
      console.log('FINANCEIRO_PACKAGED_OFFLINE_OK');
    } else {
      await evaluate(`location.hash='#/financeiro/vendas/${ids.integrated}'`);
      for (let n = 0; n < 200; n++) {
        if (
          await evaluate(
            `!!document.querySelector('[data-financial="reembolsosPendentesCentavos"]')`,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 30));
      }
      const r = await evaluate(`window.mnrApi.financeiro.obterVenda(${ids.integrated})`);
      if (!r.ok || r.data.resumo.reembolsosPendentesCentavos !== 15000)
        throw Error('Resumo inconsistente após reabertura');
      console.log('FINANCEIRO_PACKAGED_REOPEN_OK');
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
  if (snapshot(db) !== before) throw Error('Consultas do pacote alteraram o banco');
  console.log('FINANCEIRO_PACKAGED_READ_ONLY_OK', isolated);
} finally {
  db.close();
}
