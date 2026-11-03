// External CDP automation of the unmodified packaged executable and its real ASAR.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { environment } from './env.mjs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
const root = resolve('.local-data/test');
mkdirSync(root, { recursive: true });
const isolated = process.argv[2] ?? mkdtempSync(resolve(root, 'vendas-package-'));
const child = spawn(
  resolve('release/win-unpacked/MNR Perfumes.exe'),
  ['--remote-debugging-port=19230'],
  {
    cwd: isolated,
    env: environment({ LOCALAPPDATA: isolated, MNR_SMOKE: '0', MNR_DEV: '0', MNR_UI_TEST_RUN: '' }),
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
let socket;
try {
  let target;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw Error('Executável encerrou antes de abrir.');
    try {
      target = (await (await fetch('http://127.0.0.1:19230/json/list')).json()).find(
        (t) => t.type === 'page' && t.url.startsWith('mnr://'),
      );
      if (target) break;
    } catch {
      /* Aguardando CDP. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw Error('A janela empacotada não disponibilizou depuração CDP.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    }
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
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
  const { default: scenario } = await import('./vendas-scenario.cjs');
  if (process.argv[2]) {
    for (let n = 0; n < 200; n++) {
      if (await evaluate('!!window.mnrApi?.vendas')) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const result = await evaluate(`(async()=>{
      const list=await window.mnrApi.vendas.listar({});
      if(!list.ok||list.data.itens.length!==5)throw Error('Vendas ausentes na reabertura');
      for(const item of list.data.itens){const d=await window.mnrApi.vendas.obter(item.id);if(!d.ok||d.data.estado!=='CONFIRMADO')throw Error('Historico inconsistente');}
      const stock=await window.mnrApi.estoque.obter(1);if(!stock.ok||stock.data.quantidade!==22)throw Error('Saldo inconsistente');
      return true;
    })()`);
    if (!result) throw Error('Reabertura falhou');
    console.log('VENDAS_PACKAGED_REOPEN_OK', isolated);
  } else {
    await call('Network.enable');
    await scenario({
      evaluate,
      rollback: async (enabled) => {
        const db = new Database(
          resolve(isolated, 'MNR Software/MNR Perfumes/data/mnr-perfumes.db'),
        );
        try {
          db.exec(
            enabled
              ? "CREATE TRIGGER vendas_test_failure BEFORE INSERT ON movimentos_financeiros BEGIN SELECT RAISE(ABORT,'test rollback'); END"
              : 'DROP TRIGGER vendas_test_failure',
          );
        } finally {
          db.close();
        }
      },
      offline: () =>
        call('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        }),
    });
    console.log('VENDAS_PACKAGED_OFFLINE_OK', isolated);
  }
} finally {
  socket?.close();
  child.kill();
  await new Promise((resolve) =>
    child.exitCode !== null ? resolve() : child.once('exit', resolve),
  );
}
if (!process.argv[2]) {
  const repeat = spawn(process.execPath, [fileURLToPath(import.meta.url), isolated], {
    stdio: 'inherit',
    env: environment(),
  });
  const code = await new Promise((resolve, reject) => {
    repeat.once('error', reject);
    repeat.once('exit', resolve);
  });
  if (code !== 0) throw Error('Reabertura empacotada falhou');
}
