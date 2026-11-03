const { app, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
app.on('browser-window-created', (_, win) =>
  win.webContents.once('did-finish-load', () =>
    verify(win).then(
      () => {
        console.log('VENDAS_UI_OK');
        app.quit();
      },
      (e) => {
        console.error(e);
        app.exit(1);
      },
    ),
  ),
);
require('../dist/electron/main/index.js');
async function verify(win) {
  const web = win.webContents,
    evaluate = (s) => web.executeJavaScript(s);
  assert.equal(
    await evaluate('location.origin'),
    process.env.MNR_VENDAS_EXPECT_HTTP === '1' ? 'http://127.0.0.1:4200' : 'mnr://app',
  );
  const commands = [];
  let original;
  const lostReply = async () => {
    original = ipcMain._invokeHandlers.get('vendas:confirmar');
    let lost = true;
    ipcMain.removeHandler('vendas:confirmar');
    ipcMain.handle('vendas:confirmar', async (...args) => {
      commands.push(JSON.stringify(args[1]));
      const r = await original(...args);
      if (r.ok && lost) {
        lost = false;
        throw Error('Test-only lost sale reply');
      }
      return r;
    });
  };
  web.debugger.attach('1.3');
  await web.debugger.sendCommand('Network.enable');
  await require('./vendas-scenario.cjs')({
    evaluate,
    lostReply,
    rollback: async (enabled) => {
      const Database = require('better-sqlite3');
      const db = new Database(
        resolve('.local-data/test', process.env.MNR_UI_TEST_RUN, 'data/mnr-perfumes.db'),
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
      web.debugger.sendCommand('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      }),
    keyboard: async () => {
      assert.equal(await evaluate(`!!document.activeElement.closest('dialog[open]')`), true);
      for (const modifiers of [[], ['shift']]) {
        win.focus();
        web.focus();
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers });
        web.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers });
        await pause(60);
        assert.equal(await evaluate(`!!document.activeElement.closest('dialog[open]')`), true);
      }
      web.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      web.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await pause(100);
      assert.equal(await evaluate(`!!document.querySelector('mnr-confirm')`), false);
      assert.equal(
        await evaluate(`document.activeElement.textContent.trim()`),
        'Confirmar venda revisada',
      );
      web.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      web.sendInputEvent({ type: 'char', keyCode: '\r' });
      web.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await pause(100);
      assert.equal(await evaluate(`!!document.querySelector('mnr-confirm dialog[open]')`), true);
    },
    capture: async () => {
      mkdirSync('.cache/ui', { recursive: true });
      for (const [w, h] of [
        [1366, 768],
        [1000, 700],
        [640, 480],
      ])
        for (const zoom of [1, 1.25, 1.5]) {
          win.setSize(w, h);
          web.setZoomFactor(zoom);
          await pause(80);
          assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
          writeFileSync(
            resolve(`.cache/ui/vendas-${w}-${zoom}.png`),
            (await web.capturePage()).toPNG(),
          );
        }
      win.setSize(1000, 700);
      web.setZoomFactor(1);
    },
    reopen: async (id) => {
      if (process.env.MNR_VENDAS_EXPECT_HTTP === '1')
        await web.debugger.sendCommand('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
      await web.reload();
      for (let n = 0; n < 200; n++) {
        if (
          await evaluate(
            `document.querySelector('main')?.innerText.includes('Saldo exigível atual')`,
          )
        )
          break;
        await pause(30);
      }
      const r = await evaluate(`window.mnrApi.vendas.obter(${id})`);
      assert.equal(r.ok, true);
      assert.equal(r.data.estado, 'CONFIRMADO');
    },
  });
  assert.equal(commands[0], commands[1]);
  assert.match(JSON.parse(commands[0]).motivo, /^Confirmação da venda /);
  if (original) {
    ipcMain.removeHandler('vendas:confirmar');
    ipcMain.handle('vendas:confirmar', original);
  }
  web.debugger.detach();
}
