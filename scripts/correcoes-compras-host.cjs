// Test host only: never included in production ASAR/preload.
const { app, ipcMain } = require('electron');
const { existsSync, readFileSync, unlinkSync, appendFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve('.local-data/test', process.env.MNR_UI_TEST_RUN);
app.on('browser-window-created', (_, win) =>
  win.webContents.once('did-finish-load', () => {
    const channel = 'correcoes-compras:devolver',
      original = ipcMain._invokeHandlers.get(channel),
      context = ipcMain._invokeHandlers.get('correcoes-compras:obter-contexto');
    let failRead = false;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, command) => {
      const fault = resolve(root, 'fault.json'),
        mode = existsSync(fault) ? JSON.parse(readFileSync(fault, 'utf8')).mode : null;
      if (mode) unlinkSync(fault);
      appendFileSync(resolve(root, 'commands.jsonl'), JSON.stringify(command) + '\n');
      const r = await original(event, command);
      if (mode === 'lost' && r.ok) throw Error('Injected lost response after commit');
      if (mode === 'read' && r.ok) failRead = true;
      return r;
    });
    ipcMain.removeHandler('correcoes-compras:obter-contexto');
    ipcMain.handle('correcoes-compras:obter-contexto', (...args) => {
      if (failRead) {
        failRead = false;
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Consulta de teste indisponível após sucesso.',
          },
        };
      }
      return context(...args);
    });
  }),
);
require('../dist/electron/main/index.js');
