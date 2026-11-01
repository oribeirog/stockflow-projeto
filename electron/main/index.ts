import { app, BrowserWindow, protocol, net, session } from 'electron';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparePaths } from '../infrastructure/paths';
import { openDatabase } from '../infrastructure/database';
import { registerIpc } from '../ipc';
protocol.registerSchemesAsPrivileged([
  { scheme: 'mnr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const paths = preparePaths();
let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
const smoke = process.env['MNR_SMOKE'] === '1';
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      db = await openDatabase(paths.data, app.getVersion());
      const dev = !app.isPackaged && process.env['MNR_DEV'] === '1';
      const url = dev ? 'http://127.0.0.1:4200/' : 'mnr://app/index.html';
      const root = resolve(__dirname, '../../renderer/browser');
      protocol.handle('mnr', (request) => {
        const parsed = new URL(request.url);
        const file = resolve(root, '.' + decodeURIComponent(parsed.pathname));
        const rel = relative(root, file);
        if (parsed.host !== 'app' || rel.startsWith('..') || isAbsolute(rel))
          return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).href);
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              dev
                ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:4200; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'"
                : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'",
            ],
          },
        });
      });
      const window = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 640,
        minHeight: 480,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, target) => {
        if (target.split('#')[0] !== url) event.preventDefault();
      });
      window.once('ready-to-show', () => window.show());
      registerIpc(window, db, url);
      await window.loadURL(url);
      if (smoke) {
        const result = await window.webContents.executeJavaScript(`(async () => {
      const result = await window.mnrApi.system.getStatus();
      if (!result.ok || result.data.database !== 'ready') throw new Error('IPC/SQLite failed');
      if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw new Error('Node exposed');
      if (!document.querySelector('app-root h1')) throw new Error('Angular failed');
      return result;
    })()`);
        console.log('SMOKE_OK', JSON.stringify(result));
        app.quit();
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => db?.close());
