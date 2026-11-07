// Actual main/preload/renderer in all modes; no dashboard or alternate preload.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedRelatorios } = require('../tests/helpers/relatorios-fixture.cjs');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const scenario = require('./relatorios-scenario.cjs');
const packaged = process.argv.includes('--package'),
  development = process.argv.includes('--development');
assert.ok(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/ui-relatorios-'));
const directory = packaged
  ? resolve(root, 'MNR Software/MNR Perfumes/data')
  : resolve(root, 'data');
mkdirSync(directory, { recursive: true });
const db = await openDatabase(directory, 'test');
const ids = seedRelatorios(db),
  before = snapshot(db);
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
      [...(packaged ? [] : ['.']), '--remote-debugging-port=19235'],
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
    const timeout = setTimeout(() => child.kill(), 90000);
    try {
      let target;
      for (let n = 0; n < 200; n++) {
        if (child.exitCode !== null) throw Error('Electron encerrou');
        try {
          target = (await (await fetch('http://127.0.0.1:19235/json/list')).json()).find(
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
      await scenario({ evaluate, ids });
      assert.equal(snapshot(db), before);
      console.log(
        'RELATORIOS_ENV_OK',
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
