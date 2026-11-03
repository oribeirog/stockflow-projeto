// Test-only host extensions. Uses the real renderer, preload, handlers and isolated database.
const assert = require('node:assert/strict');
const { ipcMain, app } = require('electron');
const Database = require('better-sqlite3');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const { createStockService } = require('../dist/electron/services/estoque.js');
module.exports = async function estoqueUi({
  window,
  evaluate,
  until,
  click,
  fill,
  buttonText,
  route,
  screenshot,
  noOverflow,
  key,
}) {
  const db = new Database(resolve(app.getPath('userData'), 'data/mnr-perfumes.db'));
  db.pragma('foreign_keys=ON');
  const cat = createCatalogService(db, 'test'),
    stock = createStockService(db, 'test');
  const cmd = (dados) => ({ operacaoId: randomUUID(), motivo: 'Fixture estoque UI', dados });
  const marca = cat.saveReference('MARCA', cmd({ nome: 'Estoque UI' }));
  const categoria = cat.saveReference('CATEGORIA', cmd({ nome: 'Estoque UI' }));
  const base = {
    marcaId: marca.id,
    categoriaId: categoria.id,
    volumeMicrolitros: 1000,
    precoVendaCentavos: 100,
    estoqueMinimo: 3,
  };
  const product = cat.saveProduct(
    cmd({ ...base, nome: 'Água estoque interface', sku: 'ESTOQUE-UI' }),
  );
  for (let i = 0; i < 27; i++)
    cat.saveProduct(
      cmd({
        ...base,
        nome: 'Água estoque página ' + String(i).padStart(2, '0'),
        sku: 'ESTOQUE-P-' + i,
      }),
    );
  const read = () =>
    evaluate(
      `window.mnrApi.estoque.obter(${product.id}).then(r=>{if(!r.ok)throw Error(r.error.message);return r.data})`,
    );
  const moves = () =>
    db
      .prepare('SELECT * FROM movimentacoes_estoque WHERE produto_id=? ORDER BY id')
      .all(product.id);
  const audit = () =>
    db
      .prepare(
        "SELECT count(*) n FROM eventos_auditoria WHERE produto_id=? AND evento='ESTOQUE_CONTAGEM'",
      )
      .get(product.id).n;
  const detail = async () => {
    await route('estoque', 'Estoque');
    await until(`document.querySelector('#estoque-search')!==null`);
    await fill('#estoque-search', 'ESTOQUE-UI');
    await buttonText('Pesquisar');
    await until(
      `document.querySelectorAll('tbody tr').length===1 && document.querySelector('a[href="#/estoque/${product.id}"]')!==null`,
    );
    await click(`a[href="#/estoque/${product.id}"]`);
    await until(
      `document.querySelector('mnr-estoque-detalhe')?.textContent.includes('SKU ESTOQUE-UI')`,
    );
  };
  const prepare = async (action, quantity, cost) => {
    await buttonText(action);
    await until(`document.querySelector('#estoque-quantidade')!==null`);
    await fill('#estoque-quantidade', String(quantity));
    if (cost !== undefined) {
      await until(`document.querySelector('#estoque-custo')!==null`);
      await fill('#estoque-custo', cost);
    }
    await fill('#estoque-motivo', 'Conferência física pela interface');
    await buttonText('Revisar operação');
    await until(`document.querySelector('dialog[open]')!==null`);
  };
  const done = async () =>
    until(
      `document.querySelector('.feedback.success')!==null && !document.querySelector('mnr-estoque-detalhe fieldset')`,
    );
  try {
    await route('estoque', 'Estoque');
    await until(`document.querySelector('#estoque-search')!==null`);
    await fill('#estoque-search', 'agua estoque');
    await buttonText('Pesquisar');
    await until(`document.querySelectorAll('tbody tr').length===25`);
    await buttonText('Próxima');
    await until(`document.querySelectorAll('tbody tr').length===3`);
    await buttonText('Anterior');
    await until(`document.querySelectorAll('tbody tr').length===25`);
    const listChannel = 'estoque:listar',
      healthyList = ipcMain._invokeHandlers.get(listChannel);
    ipcMain.removeHandler(listChannel);
    let failList = true;
    ipcMain.handle(listChannel, async (event, input) => {
      if (failList) {
        failList = false;
        return {
          ok: false,
          error: { code: 'BUSY', message: 'Consulta temporariamente indisponível' },
        };
      }
      if (input.busca === 'delayed-stock') {
        await pause(350);
        return healthyList(event, { ...input, busca: 'agua estoque' });
      }
      return healthyList(event, input);
    });
    await buttonText('Pesquisar');
    await until(`document.querySelector('mnr-content-state[kind=error]')!==null`);
    await buttonText('Tentar novamente');
    await until(`document.querySelectorAll('tbody tr').length===25`);
    await fill('#estoque-search', 'delayed-stock');
    await buttonText('Pesquisar');
    await fill('#estoque-search', 'ESTOQUE-UI');
    await buttonText('Pesquisar');
    await until(`document.querySelectorAll('tbody tr').length===1`);
    await pause(400);
    assert.equal(
      await evaluate(`document.querySelectorAll('tbody tr').length`),
      1,
      'Ignore late old stock list',
    );
    ipcMain.removeHandler(listChannel);
    ipcMain.handle(listChannel, healthyList);
    await detail();
    await prepare('Entrada manual', 3, '1,00');
    assert.equal((await read()).quantidade, 0, 'Review does not write');
    await key('Escape');
    await until(`document.querySelector('dialog[open]')===null`);
    await until(`document.activeElement.closest('[data-review]')!==null`);
    await buttonText('Revisar operação');
    await until(`document.querySelector('dialog[open]')!==null`);
    const channel = 'estoque:registrar-entrada',
      original = ipcMain._invokeHandlers.get(channel),
      commands = [];
    let lose = true;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => {
      commands.push(JSON.stringify(args[1]));
      const result = await original(...args);
      if (result.ok && lose) {
        lose = false;
        throw new Error('Stock reply lost after commit, test only');
      }
      return result;
    });
    await evaluate(
      `(()=>{const b=Array.from(document.querySelector('dialog').querySelectorAll('button')).find(b=>b.textContent.trim()==='Confirmar');b.click();b.click();})()`,
    );
    await until(
      `document.querySelector('mnr-estoque-detalhe')?.textContent.includes('Repetir o mesmo comando')`,
    );
    assert.equal((await read()).quantidade, 3);
    assert.equal(commands.length, 1);
    assert.equal(await evaluate(`document.querySelector('fieldset').disabled`), true);
    await pause(200);
    assert.equal(commands.length, 1, 'No automatic retry');
    await click('nav a[href="#/dashboard"]');
    assert.equal(await evaluate('location.hash'), `#/estoque/${product.id}`);
    await buttonText('Repetir o mesmo comando');
    await done();
    assert.equal(commands.length, 2);
    assert.equal(commands[0], commands[1]);
    assert.equal(moves().length, 1);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, original);
    assert.equal((await read()).custoMedioDecimal, '0,33');
    await prepare('Saída manual', 1);
    await buttonText('Confirmar');
    await done();
    assert.equal((await read()).valorTotalCentavos, 67);
    await prepare('Registro de perda', 1);
    await buttonText('Confirmar');
    await done();
    assert.equal((await read()).valorTotalCentavos, 33);
    const n = moves().length,
      a = audit();
    await prepare('Contagem física', 1);
    await buttonText('Confirmar');
    await done();
    assert.equal(moves().length, n);
    assert.equal(audit(), a + 1);
    assert.match(
      await evaluate(`document.querySelector('.feedback.success').textContent`),
      /sem movimentação/,
    );
    await prepare('Contagem física', 2, '0,70');
    stock.registrarEntrada({
      ...cmd({ produtoId: product.id, quantidade: 1, custoTotalCentavos: 10 }),
      dataEfetiva: '2026-10-31',
    });
    await buttonText('Confirmar');
    await until(`document.querySelector('.feedback')?.textContent.includes('O saldo mudou')`);
    assert.equal(await evaluate(`document.querySelector('#estoque-quantidade').value`), '2');
    await buttonText('Atualizar saldo');
    await until(
      `document.querySelector('mnr-estoque-detalhe').textContent.includes('Saldo atualizado')`,
    );
    assert.equal(await evaluate(`document.querySelector('#estoque-quantidade').value`), '2');
    await fill('#estoque-quantidade', '3');
    await fill('#estoque-custo', '0,70');
    await buttonText('Revisar operação');
    await until(`document.querySelector('dialog[open]')!==null`);
    await buttonText('Confirmar');
    await done();
    assert.equal((await read()).quantidade, 3);
    await prepare('Contagem física', 1);
    await buttonText('Confirmar');
    await done();
    assert.equal((await read()).quantidade, 1);
    await buttonText('Saída manual');
    await fill('#estoque-quantidade', '2');
    await fill('#estoque-motivo', 'Saída insuficiente');
    await buttonText('Revisar operação');
    await until(`document.querySelector('[aria-invalid=true]')!==null`);
    assert.equal((await read()).quantidade, 1);
    await buttonText('Descartar preenchimento');
    // A competing writer empties stock after review; the backend still prevents negative stock.
    await prepare('Saída manual', 1);
    stock.registrarPerda({
      ...cmd({ produtoId: product.id, quantidade: 1 }),
      dataEfetiva: '2026-10-31',
    });
    await buttonText('Confirmar');
    await until(
      `document.querySelector('.feedback')?.textContent.includes('Estoque insuficiente')`,
    );
    assert.equal((await read()).quantidade, 0);
    await buttonText('Descartar preenchimento');
    await buttonText('Atualizar saldo');
    await until(
      `document.querySelector('mnr-estoque-detalhe .summary')?.textContent.includes('Disponível: 0')`,
    );
    // Inject a read failure after successful commit: offer consultation only, never a second write.
    await prepare('Entrada manual', 2, '0,01');
    const getChannel = 'estoque:obter',
      healthyGet = ipcMain._invokeHandlers.get(getChannel);
    let failRead = true;
    ipcMain.removeHandler(getChannel);
    ipcMain.handle(getChannel, (...args) => {
      if (failRead) {
        failRead = false;
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Teste de leitura' } };
      }
      return healthyGet(...args);
    });
    const before = moves().length;
    await buttonText('Confirmar');
    await done();
    assert.match(
      await evaluate(`document.querySelector('.feedback.success').textContent`),
      /operação já foi concluída/,
    );
    await buttonText('Consultar novamente');
    await until(`!document.querySelector('mnr-content-state[kind=error]')`);
    assert.equal(moves().length, before + 1);
    ipcMain.removeHandler(getChannel);
    ipcMain.handle(getChannel, healthyGet);
    // Paginated history across more than one page.
    for (let i = 0; i < 26; i++)
      stock.registrarEntrada({
        ...cmd({ produtoId: product.id, quantidade: 1, custoTotalCentavos: 0 }),
        dataEfetiva: '2026-10-31',
      });
    await detail();
    await until(`document.querySelectorAll('.history tbody tr').length===25`);
    await buttonText('Próxima');
    await until(`document.querySelector('.history nav').textContent.includes('Página 2')`);
    await buttonText('Anterior');
    await until(`document.querySelector('.history nav').textContent.includes('Página 1')`);
    await buttonText('Contagem física');
    await fill('#estoque-quantidade', '1');
    await click('nav a[href="#/dashboard"]');
    await until(`document.querySelector('dialog[open]')!==null`);
    await key('Escape');
    assert.equal(await evaluate('location.hash'), `#/estoque/${product.id}`);
    // Real keyboard focus and responsive layout, including expanded sidebar.
    await evaluate(`document.querySelector('#estoque-quantidade').focus()`);
    await key('Tab');
    assert.equal(await evaluate('document.activeElement.id'), 'estoque-data');
    for (const [width, height] of [
      [1366, 768],
      [1000, 700],
      [640, 480],
    ]) {
      window.setSize(width, height);
      for (const zoom of [1, 1.25, 1.5]) {
        window.webContents.setZoomFactor(zoom);
        await pause(80);
        await noOverflow();
        await screenshot(`estoque-detail-${width}-${height}-${zoom}`);
        await evaluate(
          `document.querySelector('#estoque-quantidade').focus();document.querySelector('#estoque-quantidade').scrollIntoView({block:'center'})`,
        );
        await screenshot(`estoque-form-${width}-${height}-${zoom}`);
        await evaluate(`document.querySelector('[data-review]').scrollIntoView({block:'end'})`);
        await screenshot(`estoque-actions-${width}-${height}-${zoom}`);
        await evaluate(`document.querySelector('.history h2').scrollIntoView({block:'start'})`);
        await screenshot(`estoque-history-${width}-${height}-${zoom}`);
        if (await evaluate('innerWidth < 900')) {
          await click('.menu-toggle');
          await noOverflow();
          await screenshot(`estoque-sidebar-${width}-${height}-${zoom}`);
          await click('.sidebar-toggle');
        }
      }
    }
    window.setSize(1000, 700);
    window.webContents.setZoomFactor(1);
    await buttonText('Descartar preenchimento');
    await route('estoque', 'Estoque');
    await until(`document.querySelectorAll('tbody tr').length>0`);
    for (const [width, height] of [
      [1366, 768],
      [1000, 700],
      [640, 480],
    ]) {
      window.setSize(width, height);
      for (const zoom of [1, 1.25, 1.5]) {
        window.webContents.setZoomFactor(zoom);
        await pause(60);
        await noOverflow();
        await screenshot(`estoque-list-${width}-${height}-${zoom}`);
      }
    }
    window.setSize(1000, 700);
    window.webContents.setZoomFactor(1);
    // Product routes and a real mutation also work with the network unavailable.
    const web = window.webContents;
    await web.debugger.attach('1.3');
    await web.debugger.sendCommand('Network.enable');
    await web.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    try {
      await detail();
      await prepare('Registro de perda', 1);
      window.setSize(640, 480);
      web.setZoomFactor(1.5);
      await pause(250);
      await evaluate(
        `document.querySelector('dialog h2').focus();document.querySelector('dialog').scrollTop=0`,
      );
      assert.equal(await evaluate('document.activeElement.id'), 'confirm-title');
      assert.equal(
        await evaluate(
          `document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth+1`,
        ),
        true,
      );
      await screenshot('estoque-confirmation-640-150');
      await key('Escape');
      await until(`document.querySelector('dialog[open]')===null`);
      window.setSize(1000, 700);
      web.setZoomFactor(1);
      await buttonText('Revisar operação');
      await until(`document.querySelector('dialog[open]')!==null`);
      await buttonText('Confirmar');
      await done();
      await screenshot('estoque-offline');
    } finally {
      web.debugger.detach();
    }
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(db.pragma('foreign_key_check').length, 0);
    console.log(
      'ESTOQUE_UI_OK: real writes, counts, versions, lost replies, exact costs, pagination, keyboard, responsive and offline',
    );
  } finally {
    db.close();
  }
};
