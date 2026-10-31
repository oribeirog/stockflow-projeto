import { isTrustedRequest } from './trust';
import { app, ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { STATUS_CHANNEL, type Result, type SystemStatus } from '../../shared/contracts';
export function registerIpc(window: BrowserWindow, db: Database.Database, allowedUrl: string) {
  ipcMain.handle(STATUS_CHANNEL, (event, ...args: unknown[]): Result<SystemStatus> => {
    if (!isTrustedRequest(event, window, allowedUrl, args)) {
      throw new Error('Opera??o IPC n?o autorizada.');
    }
    try {
      db.prepare('SELECT 1').get();
      return { ok: true, data: { database: 'ready', version: app.getVersion() } };
    } catch (error) {
      console.error('Database status failed', error);
      return { ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Banco indispon?vel.' } };
    }
  });
}
