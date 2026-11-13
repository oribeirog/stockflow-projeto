import { ipcMain, type BrowserWindow } from 'electron';
import { CANAIS_BACKUP } from '../../shared/backup';
import { isTrustedSender } from './trust';
import { BackupController } from '../services/backup/controller';
import { BackupError, backupMessage } from '../services/backup/io';
export function registerBackup(window: BrowserWindow, url: string, service: BackupController) {
  const handlers = {
    estado: () => service.status(),
    criar: () => service.create(),
    selecionar: () => service.inspect(),
    descartar: (input: unknown) => service.discard(input),
    restaurar: (input: unknown) => service.restore(input),
    abrirProtecoes: () => service.openProtections(),
  };
  for (const method of Object.keys(CANAIS_BACKUP) as (keyof typeof CANAIS_BACKUP)[])
    ipcMain.handle(CANAIS_BACKUP[method], async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, window, url)) throw Error('Operação IPC não autorizada.');
      try {
        if (args.length !== (['descartar', 'restaurar'].includes(method) ? 1 : 0))
          throw new BackupError('STALE_REVIEW');
        return { ok: true, data: await handlers[method](args[0]) };
      } catch (error) {
        return { ok: false, error: backupMessage(error) };
      }
    });
}
