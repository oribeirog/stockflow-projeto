// Test-only host. Production handlers/preload and Angular services, isolated SQLite.
const { app, BrowserWindow, protocol, net } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync } = require('node:fs');
const { resolve, join, relative, isAbsolute } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const { setTimeout: pause } = require('node:timers/promises');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { registerIpc } = require('../dist/electron/ipc/index.js');
const { CANAIS_CADASTROS } = require('../dist/shared/cadastros-ipc.js');
const { CANAIS_ESTOQUE } = require('../dist/shared/estoque-ipc.js');
const { CANAIS_COMPRAS } = require('../dist/shared/compras-ipc.js');
const { CANAIS_VENDAS } = require('../dist/shared/vendas-ipc.js');
const { CANAIS_FINANCEIRO } = require('../dist/shared/financeiro-ipc.js');
const { CANAIS_CORRECOES } = require('../dist/shared/correcoes-ipc.js');
const { CANAIS_CORRECOES_COMPRAS } = require('../dist/shared/correcoes-compras-ipc.js');
const { CANAIS_ESTORNOS_ESTOQUE } = require('../dist/shared/estornos-estoque-ipc.js');
const { CANAIS_RELATORIOS } = require('../dist/shared/relatorios-ipc.js');
const { CANAIS_EXPORTACOES } = require('../dist/shared/exportacoes.js');
const root = resolve('.cache/cadastros-renderer/browser');
mkdirSync('.local-data/test', { recursive: true });
const directory = mkdtempSync(resolve('.local-data/test/cadastros-ipc-'));
app.setPath('userData', directory);
app.setPath('sessionData', directory);
app.setPath('crashDumps', directory);
protocol.registerSchemesAsPrivileged([
  { scheme: 'mnr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let db;
let server;
app.on('window-all-closed', () => {
  /* Keep the test host alive between origins. */
});
const timer = setTimeout(() => {
  console.error('Integration timeout');
  app.exit(1);
}, 60000);
app
  .whenReady()
  .then(async () => {
    server = createServer((request, response) => {
      try {
        const path = resolve(
          root,
          '.' +
            (request.url === '/'
              ? '/index.html'
              : new URL(request.url, 'http://localhost').pathname),
        );
        const rel = relative(root, path);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          response.writeHead(403).end();
          return;
        }
        response.setHeader(
          'Content-Type',
          path.endsWith('.js')
            ? 'text/javascript'
            : path.endsWith('.css')
              ? 'text/css'
              : 'text/html',
        );
        response.end(readFileSync(path));
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    protocol.handle('mnr', (request) => {
      const url = new URL(request.url);
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      const rel = relative(root, path);
      if (url.host !== 'app' || rel.startsWith('..') || isAbsolute(rel))
        return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(path).href);
    });
    const { ipcMain } = require('electron');
    for (const url of [`http://127.0.0.1:${server.address().port}/`, 'mnr://app/index.html']) {
      const fixture = join(directory, url.startsWith('http') ? 'dev' : 'local');
      mkdirSync(fixture);
      db = await openDatabase(fixture, app.getVersion());
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: resolve('dist/electron/preload/index.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      window.webContents.on('console-message', (event) => console.log('RENDERER', event.message));
      window.webContents.on('did-fail-load', (_event, code, description) =>
        console.error('LOAD', code, description),
      );
      window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'",
            ],
          },
        }),
      );
      registerIpc(window, db, url);
      await window.loadURL(url);
      let result;
      for (let attempt = 0; attempt < 400; attempt++) {
        result = await window.webContents.executeJavaScript(
          '({result: document.body.dataset.resultado, text: document.body.innerText})',
        );
        if (result.result) break;
        await pause(50);
      }
      assert.equal(result.result, 'CADASTROS_ANGULAR_OK', result.text);
      assert.equal(
        await window.webContents.executeJavaScript('typeof window.require'),
        'undefined',
      );
      assert.equal(
        await window.webContents.executeJavaScript('typeof window.process'),
        'undefined',
      );
      const product = db.prepare('SELECT id FROM produtos WHERE sku=?').get('INTEGRACAO');
      assert.equal(db.prepare('SELECT count(*) n FROM produtos').get().n, 1);
      assert.equal(
        db.prepare('SELECT count(*) n FROM historico_precos WHERE produto_id=?').get(product.id).n,
        1,
      );
      assert.equal(
        db.prepare('SELECT count(*) n FROM eventos_auditoria WHERE produto_id=?').get(product.id).n,
        3,
      );
      assert.deepEqual(
        db
          .prepare(
            'SELECT quantidade, valor_total_centavos, versao FROM saldos_estoque WHERE produto_id=?',
          )
          .get(product.id),
        { quantidade: 0, valor_total_centavos: 0, versao: 0 },
      );
      assert.equal(db.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 0);
      assert.equal(db.pragma('user_version', { simple: true }), 5);
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(db.pragma('foreign_key_check').length, 0);
      console.log(
        'CADASTROS_ANGULAR_OK',
        url.startsWith('http') ? 'development-origin UUID' : 'mnr-origin UUID',
      );
      window.destroy();
      db.close();
      db = undefined;
      for (const channels of Object.values(CANAIS_CADASTROS))
        for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
      ipcMain.removeHandler('system:get-status');
      for (const channel of Object.values(CANAIS_ESTOQUE)) ipcMain.removeHandler(channel);
      for (const channel of Object.values(CANAIS_COMPRAS)) ipcMain.removeHandler(channel);
      for (const channel of Object.values(CANAIS_VENDAS)) ipcMain.removeHandler(channel);
      for (const channel of [
        ...Object.values(CANAIS_FINANCEIRO),
        ...Object.values(CANAIS_CORRECOES),
        ...Object.values(CANAIS_CORRECOES_COMPRAS),
        ...Object.values(CANAIS_ESTORNOS_ESTOQUE),
        ...Object.values(CANAIS_RELATORIOS),
        ...Object.values(CANAIS_EXPORTACOES),
      ])
        ipcMain.removeHandler(channel);
    }
    clearTimeout(timer);
    server.close();
    app.quit();
  })
  .catch((error) => {
    clearTimeout(timer);
    console.error(error);
    db?.close();
    server?.close();
    app.exit(1);
  });
