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
        console.log('CORRECOES_UI_OK');
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
  const dir = resolve('.local-data/test', process.env.MNR_UI_TEST_RUN),
    ids = JSON.parse(readFileSync(resolve(dir, 'fixture.json'), 'utf8'));
  const db = await openDatabase(resolve(dir, 'data'), 'test'),
    web = win.webContents,
    evaluate = (s) => web.executeJavaScript(s);
  let lost = false,
    failRead = false,
    afterCommit = false,
    replayed = [],
    writeCount = 0,
    beforeRead = 0;
  const channel = 'correcoes:devolver-venda',
    original = ipcMain._invokeHandlers.get(channel);
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, cmd) => {
    writeCount++;
    const result = await original(event, cmd);
    if (lost) {
      replayed.push(JSON.stringify(cmd));
      lost = false;
      throw Error('Injected correction response lost AFTER commit');
    }
    if (replayed.length === 1) replayed.push(JSON.stringify(cmd));
    if (failRead && result.ok) {
      afterCommit = true;
      failRead = false;
    }
    return result;
  });
  const getChannel = 'correcoes:obter-contexto-venda',
    get = ipcMain._invokeHandlers.get(getChannel);
  ipcMain.removeHandler(getChannel);
  ipcMain.handle(getChannel, (...args) => {
    if (afterCommit) {
      afterCommit = false;
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Consulta indisponível após commit.' },
      };
    }
    return get(...args);
  });
  try {
    if (process.env.MNR_CORRECOES_REOPEN === '1') {
      const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs'),
        before = snapshot(db);
      const v = await evaluate(`window.mnrApi.financeiro.obterVenda(${ids.entry.id})`);
      assert.equal(v.data.resumo.reembolsosPendentesCentavos, 15000);
      const c = await evaluate(`window.mnrApi.correcoes.obterContextoVenda(${ids.main.id})`);
      assert.equal(c.data.itens[0].quantidadeDisponivel, 0);
      const stock = await evaluate(`window.mnrApi.estoque.obter(${ids.productId})`);
      const expected = JSON.parse(readFileSync(resolve(dir, 'expected-stock.json'), 'utf8'));
      assert.equal(stock.data.quantidade, expected.quantidade);
      assert.equal(stock.data.valorTotalCentavos, expected.valor_total_centavos);
      const docs = await evaluate(
        `window.mnrApi.correcoes.listarDocumentos({vendaId:${ids.main.id}})`,
      );
      assert.equal(docs.data.itens.length, 2);
      await evaluate(`location.hash='#/financeiro/vendas/${ids.entry.id}'`);
      for (let n = 0; n < 200; n++) {
        if (await evaluate(`!!document.querySelector('[data-financial="saldoReceberCentavos"]')`))
          break;
        await pause(30);
      }
      assert.equal(snapshot(db), before);
      assert.equal(writeCount, 0);
      console.log('CORRECOES_REOPEN_OK');
      return;
    }
    assert.equal(
      await evaluate('location.origin'),
      process.env.MNR_DEV === '1' ? 'http://127.0.0.1:4200' : 'mnr://app',
    );
    for (const key of ['sandbox', 'contextIsolation'])
      assert.equal(web.getLastWebPreferences()[key], true);
    assert.equal(web.getLastWebPreferences().nodeIntegration, false);
    await require('./correcoes-scenario.cjs')({
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
            await pause(100);
            await evaluate(
              `document.querySelector(${JSON.stringify(name === 'formulario' ? '.table-wrap' : name === 'resultado' ? '[aria-label="Correção concluída"]' : '#correcao-revisao')})?.scrollIntoView({block:'start'})`,
            );
            assert.equal(
              await evaluate('document.documentElement.scrollWidth<=innerWidth'),
              true,
              `${w} ${zoom}`,
            );
            writeFileSync(
              resolve(
                `.cache/ui/correcoes-${process.env.MNR_DEV === '1' ? 'http' : 'local'}-${name}-${w}-${zoom}.png`,
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
        await evaluate(`document.querySelector('#correcao-confirmar button').focus()`);
        const key = async (keyCode, modifiers = []) => {
          web.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
          if (keyCode === 'Enter') web.sendInputEvent({ type: 'char', keyCode: '\r' });
          web.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
          await pause(100);
        };
        await key('Tab');
        assert.equal(await evaluate('document.activeElement!==document.body'), true);
        await key('Tab', ['shift']);
        await evaluate(`document.querySelector('#correcao-confirmar button').focus()`);
        await key('Enter');
        assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`), true);
        await key('Escape');
        assert.equal(
          await evaluate(
            `document.activeElement===document.querySelector('#correcao-confirmar button')`,
          ),
          true,
        );
      },
      faults: {
        concurrent: () =>
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
            }),
        rollback: (enabled) =>
          db.exec(
            enabled
              ? "CREATE TRIGGER fail_ui_correction BEFORE INSERT ON abatimentos_parcela BEGIN SELECT RAISE(ABORT,'injected correction rollback'); END"
              : 'DROP TRIGGER fail_ui_correction',
          ),
        loseReply: () => {
          lost = true;
        },
        checkReplay: () => {
          assert.equal(replayed.length, 2);
          assert.equal(replayed[0], replayed[1]);
        },
        readFailure: () => {
          failRead = true;
          beforeRead = writeCount;
        },
        checkRead: () => assert.equal(writeCount, beforeRead + 1),
      },
    });
    writeFileSync(
      resolve(dir, 'expected-stock.json'),
      JSON.stringify(
        db
          .prepare('SELECT quantidade,valor_total_centavos FROM saldos_estoque WHERE produto_id=?')
          .get(ids.productId),
      ),
    );
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
}
