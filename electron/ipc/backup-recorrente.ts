import { ipcMain, type BrowserWindow } from 'electron';
import { CANAIS_BACKUP_RECORRENTE } from '../../shared/backup-policy';
import { isTrustedSender } from './trust';
import { BackupError, backupMessage } from '../services/backup/io';
import type { RecurringBackupService } from '../services/backup/recurring';

export function registerRecurringBackup(
  window: BrowserWindow,
  url: string,
  service: RecurringBackupService,
  registrar: Pick<typeof ipcMain, 'handle'> = ipcMain,
) {
  const methods = {
    estado: () => service.status(),
    utilizar: () => service.use(),
    selecionarPasta: () => service.selectFolder(),
    configurar: (i: unknown) => service.configure(i),
    executar: () => service.execute(),
    adiar: (i: unknown) => service.defer(i),
  };
  for (const name of Object.keys(
    CANAIS_BACKUP_RECORRENTE,
  ) as (keyof typeof CANAIS_BACKUP_RECORRENTE)[])
    registrar.handle(CANAIS_BACKUP_RECORRENTE[name], async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, window, url)) throw Error('Operação IPC não autorizada.');
      try {
        if (args.length !== (['configurar', 'adiar'].includes(name) ? 1 : 0))
          throw new BackupError('VALIDATION');
        return { ok: true, data: await methods[name](args[0]) };
      } catch (e) {
        const error = backupMessage(e);
        if (error.code === 'VALIDATION')
          error.message = 'Confira as opções de backup recorrente e tente novamente.';
        return { ok: false, error };
      }
    });
}
