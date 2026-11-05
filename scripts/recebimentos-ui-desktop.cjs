const { app, ipcMain } = require('electron');
const { resolve } = require('node:path');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { openDatabase } = require('../dist/electron/infrastructure/database');
app.on('browser-window-created', (_, win) =>
  win.webContents.once('did-finish-load', () =>
    verify(win).then(
      () => {
        console.log('RECEBIMENTOS_UI_OK');
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
  const web = win.webContents,
    evaluate = (s) => web.executeJavaScript(s);
  let lost = false,
    failRead = false,
    afterCommit = false,
    replayed = [],
    writeCount = 0,
    readCount = 0;
  const channel = 'financeiro:registrar-recebimento',
    original = ipcMain._invokeHandlers.get(channel);
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, cmd) => {
    writeCount++;
    const result = await original(event, cmd);
    if (lost) {
      replayed.push(JSON.stringify(cmd));
      lost = false;
      throw Error('Injected response lost AFTER commit');
    }
    if (replayed.length === 1) replayed.push(JSON.stringify(cmd));
    if (failRead && result.ok) {
      afterCommit = true;
      failRead = false;
    }
    return result;
  });
  const getChannel = 'financeiro:obter-venda',
    get = ipcMain._invokeHandlers.get(getChannel);
  ipcMain.removeHandler(getChannel);
  ipcMain.handle(getChannel, (...args) => {
    if (afterCommit) {
      afterCommit = false;
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Consulta indisponível após gravação confirmada.',
        },
      };
    }
    return get(...args);
  });
  try {
    if (process.env.MNR_RECEBIMENTOS_REOPEN === '1') {
      const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
      const before = snapshot(db);
      await evaluate(`location.hash='#/financeiro/vendas/${ids.main.id}'`);
      for (let n = 0; n < 200; n++) {
        if (await evaluate(`!!document.querySelector('[data-financial="saldoReceberCentavos"]')`))
          break;
        await pause(30);
      }
      const v = await evaluate(`window.mnrApi.financeiro.obterVenda(${ids.main.id})`);
      assert.equal(v.ok, true);
      assert.equal(v.data.resumo.saldoReceberCentavos, 0);
      assert.equal(v.data.resumo.recebimentosEfetivosCentavos, 30000);
      const m = await evaluate(
        `window.mnrApi.financeiro.listarMovimentos({vendaId:${ids.main.id}})`,
      );
      assert.equal(m.ok, true);
      assert.equal(m.data.itens.length, 5);
      assert.equal(snapshot(db), before);
      assert.equal(writeCount, 0);
      console.log('RECEBIMENTOS_REOPEN_OK');
      return;
    }
    assert.equal(
      await evaluate('location.origin'),
      process.env.MNR_DEV === '1' ? 'http://127.0.0.1:4200' : 'mnr://app',
    );
    for (const key of ['sandbox', 'contextIsolation'])
      assert.equal(web.getLastWebPreferences()[key], true);
    assert.equal(web.getLastWebPreferences().nodeIntegration, false);
    await require('./recebimentos-scenario.cjs')({
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
            win.setSize(w, h);
            web.setZoomFactor(zoom);
            await pause(80);
            await evaluate(
              `document.querySelector(${JSON.stringify(name === 'revisao' ? '#receber-revisao' : '[aria-label="Recebimento concluído"]')})?.scrollIntoView({block:'start'})`,
            );
            assert.equal(
              await evaluate('document.documentElement.scrollWidth<=innerWidth'),
              true,
              `${w} ${zoom}`,
            );
            writeFileSync(
              resolve(
                `.cache/ui/recebimentos-${process.env.MNR_DEV === '1' ? 'http' : 'local'}-${name}-${w}-${zoom}.png`,
              ),
              (await web.capturePage()).toPNG(),
            );
          }
        win.setSize(1000, 700);
        web.setZoomFactor(1);
      },
      keyboard: async () => {
        win.focus();
        web.focus();
        await evaluate(
          'document.getElementById("receber-confirmar").querySelector("button").focus()',
        );
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        web.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await pause(60);
        assert.equal(await evaluate('document.activeElement!==document.body'), true);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
        web.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
        await evaluate(
          'document.getElementById("receber-confirmar").querySelector("button").focus()',
        );
        await pause(80);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        web.sendInputEvent({ type: 'char', keyCode: '\r' });
        web.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        await pause(60);
        assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), true);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        web.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await pause(100);
        assert.equal(
          await evaluate(
            'document.activeElement===document.getElementById("receber-confirmar").querySelector("button")',
          ),
          true,
        );
      },
      faults: {
        concurrent: () => {
          require('../dist/electron/services/financeiro')
            .createFinancialService(db, 'test')
            .registrarRecebimento({
              operacaoId: randomUUID(),
              motivo: 'Recebimento concorrente isolado',
              dados: {
                vendaId: ids.fault.id,
                dataEfetiva: '2026-11-01',
                pagamentos: [{ formaPagamentoId: ids.pix, valorCentavos: 1000 }],
              },
            });
        },
        loseReply: () => {
          lost = true;
        },
        checkReplay: () => {
          assert.equal(replayed.length, 2);
          assert.equal(replayed[0], replayed[1]);
          assert.equal(
            require('../dist/electron/services/financeiro-consulta')
              .createFinancialQueryService(db)
              .obterVenda(ids.fault.id).resumo.saldoReceberCentavos,
            24000,
          );
        },
        readFailure: () => {
          failRead = true;
          readCount = writeCount;
        },
        checkRead: () => assert.equal(writeCount, readCount + 1),
        inactive: (ativo) =>
          require('../dist/electron/services/catalogos')
            .createCatalogService(db, 'test')
            .saveReference('FORMA_PAGAMENTO', {
              operacaoId: randomUUID(),
              motivo: 'Alteração isolada de teste',
              dados: { id: ids.pix, nome: 'Pix', ativo: !ativo },
            }),
        rollback: (enabled) => {
          if (enabled)
            db.exec(
              "CREATE TRIGGER fail_ui_receipt BEFORE INSERT ON alocacoes_recebimento BEGIN SELECT RAISE(ABORT, 'injected receipt rollback'); END",
            );
          else db.exec('DROP TRIGGER fail_ui_receipt');
        },
      },
    });
    const check = db.pragma('integrity_check', { simple: true });
    assert.equal(check, 'ok');
  } finally {
    db.close();
  }
}
