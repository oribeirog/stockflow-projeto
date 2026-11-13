import { criarHandlersVendas } from './vendas';
import { registerExportacoes } from './exportacoes';
import { criarHandlersRelatorios } from './relatorios';
import { criarHandlersConsultasFinanceiras } from './financeiro';
import { isTrustedRequest, isTrustedSender } from './trust';
import { criarHandlersCadastros } from './cadastros';
import { criarHandlersEstoque } from './estoque';
import { criarHandlersCompras } from './compras';
import { criarHandlersCorrecoesCompras } from './correcoes-compras';
import { criarHandlersEstornosEstoque } from './estornos-estoque';
import { app, ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { STATUS_CHANNEL, type Result, type SystemStatus } from '../../shared/contracts';
import { registerFotos } from './fotos';
import type { FotoService } from '../services/fotos';
import { registerBackup } from './backup';
import type { BackupController } from '../services/backup/controller';
export function registerIpc(
  window: BrowserWindow,
  db: Database.Database,
  allowedUrl: string,
  photos?: FotoService,
  backup?: BackupController,
) {
  const registrar: Pick<typeof ipcMain, 'handle'> = {
    handle: (channel, handler) =>
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        if (!isTrustedSender(event, window, allowedUrl))
          throw new Error('Operação IPC não autorizada.');
        return backup ? backup.gate.run(() => handler(event, ...args)) : handler(event, ...args);
      }),
  };
  registerExportacoes(window, db, allowedUrl, registrar);
  if (photos) registerFotos(window, allowedUrl, photos, registrar);
  if (backup) registerBackup(window, allowedUrl, backup);
  for (const [channel, handler] of [
    ...criarHandlersCadastros(db, app.getVersion()),
    ...criarHandlersEstoque(db, app.getVersion()),
    ...criarHandlersCompras(db, app.getVersion()),
    ...criarHandlersCorrecoesCompras(db, app.getVersion()),
    ...criarHandlersEstornosEstoque(db, app.getVersion()),
    ...criarHandlersVendas(db, app.getVersion()),
    ...criarHandlersRelatorios(db),
    ...criarHandlersConsultasFinanceiras(db, undefined, app.getVersion()),
  ]) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, window, allowedUrl)) {
        throw new Error('Operação IPC não autorizada.');
      }
      return backup ? backup.gate.run(() => handler(...args)) : handler(...args);
    });
  }
  ipcMain.handle(STATUS_CHANNEL, (event, ...args: unknown[]): Result<SystemStatus> => {
    if (!isTrustedRequest(event, window, allowedUrl, args)) {
      throw new Error('Operação IPC não autorizada.');
    }
    try {
      if (backup?.gate.blocked)
        return {
          ok: false,
          error: {
            code: 'BUSY',
            message: 'Proteção de dados em andamento. Aguarde a reabertura validada.',
          },
        };
      db.prepare('SELECT 1').get();
      return { ok: true, data: { database: 'ready', version: app.getVersion() } };
    } catch (error) {
      console.error('Database status failed', error);
      return { ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'Banco indisponível.' } };
    }
  });
}
