// Test-only host; never packaged. Preserves real handlers, preload, main and sender validation.
const { ipcMain } = require('electron');
const { readFileSync, existsSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const control = resolve('.local-data/test', process.env.MNR_UI_TEST_RUN, 'dashboard-fault.json');
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) =>
  register(channel, async (...args) => {
    if (channel !== 'relatorios:obter-resumo-gerencial' || !existsSync(control))
      return handler(...args);
    const fault = JSON.parse(readFileSync(control, 'utf8'));
    // Always call the protected original first, even for injected failures.
    const result = await handler(...args);
    if (fault.fail) throw Error('Injected Dashboard IPC failure');
    if (fault.delay && args[1]?.dataInicio === fault.from) {
      writeFileSync(control + '.entered', '1');
      await new Promise((r) => setTimeout(r, fault.delay));
      writeFileSync(control + '.finished', '1');
    }
    return result;
  });
require('../dist/electron/main/index.js');
