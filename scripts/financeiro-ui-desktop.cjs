const { app } = require('electron');
const { resolve } = require('node:path');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
app.on('browser-window-created', (_, win) =>
  win.webContents.once('did-finish-load', () =>
    verify(win).then(
      () => {
        console.log('FINANCEIRO_UI_OK');
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
  const dir = resolve('.local-data/test', process.env.MNR_UI_TEST_RUN);
  const ids = JSON.parse(readFileSync(resolve(dir, 'fixture.json'), 'utf8'));
  const db = await openDatabase(resolve(dir, 'data'), 'test');
  const before = snapshot(db);
  const web = win.webContents,
    evaluate = (s) => web.executeJavaScript(s);
  try {
    assert.equal(
      await evaluate('location.origin'),
      process.env.MNR_DEV === '1' ? 'http://127.0.0.1:4200' : 'mnr://app',
    );
    for (const key of ['sandbox', 'contextIsolation'])
      assert.equal(web.getLastWebPreferences()[key], true);
    assert.equal(web.getLastWebPreferences().nodeIntegration, false);
    await require('./financeiro-scenario.cjs')({
      evaluate,
      ids,
      keyboard: async () => {
        win.focus();
        web.focus();
        await evaluate(`document.getElementById('financeiro-cliente').focus()`);
        for (const modifiers of [[], ['shift']]) {
          web.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers });
          web.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers });
          await pause(60);
          assert.equal(await evaluate(`document.activeElement!==document.body`), true);
        }
      },
      capture: async (name) => {
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
              resolve(`.cache/ui/financeiro-${name}-${w}-${zoom}.png`),
              (await web.capturePage()).toPNG(),
            );
          }
        win.setSize(1000, 700);
        web.setZoomFactor(1);
      },
      reload: async () => {
        await web.reload();
        await pause(150);
      },
    });
    assert.equal(snapshot(db), before, 'Consultas na interface não podem gravar');
    console.log('FINANCEIRO_READ_ONLY_OK');
  } finally {
    db.close();
  }
}
