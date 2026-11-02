import { isTrustedRequest, isTrustedSender } from './trust';
import { criarHandlersCadastros } from './cadastros';
import { app, ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { STATUS_CHANNEL, type Result, type SystemStatus } from '../../shared/contracts';
export function registerIpc(window: BrowserWindow, db: Database.Database, allowedUrl: string) {
  for (const [channel, handler] of criarHandlersCadastros(db, app.getVersion())) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, window, allowedUrl)) {
        throw new Error('Operação IPC não autorizada.');
      }
      return handler(...args);
    });
  }
  ipcMain.handle(STATUS_CHANNEL, (event, ...args: unknown[]): Result<SystemStatus> => {
    if (!isTrustedRequest(event, window, allowedUrl, args)) {
      throw new Error('Operação IPC não autorizada.');
    }
    try {
      db.prepare('SELECT 1').get();
      return { ok: true, data: { database: 'ready', version: app.getVersion() } };
    } catch (error) {
      console.error('Database status failed', error);
      return { ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Banco indisponível.' } };
    }
  });
}
