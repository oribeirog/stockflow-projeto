import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { CANAIS_FOTOS } from '../../shared/fotos';
import { isTrustedSender } from './trust';
import { erroCadastro } from './cadastros';
import type { FotoService } from '../services/fotos';
import { FotoError, MAX_SOURCE } from '../services/foto-validation';
import { CadastroError } from '../services/catalog-validation';

export function readSelectedFoto(path: string): Buffer {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    throw new FotoError('PHOTO_ACCESS');
  }
  try {
    const stat = fstatSync(fd);
    if (stat.size > MAX_SOURCE) throw new FotoError('PHOTO_SIZE');
    if (!stat.isFile() || !stat.size) throw new FotoError('PHOTO_INVALID');
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0,
      read = 0;
    do {
      read = readSync(fd, bytes, count, bytes.length - count, null);
      count += read;
    } while (read && count < bytes.length);
    if (count !== stat.size) throw new FotoError('PHOTO_INVALID');
    return bytes.subarray(0, count);
  } catch (error) {
    if (error instanceof FotoError) throw error;
    throw new FotoError('PHOTO_ACCESS');
  } finally {
    closeSync(fd);
  }
}
export function registerFotos(
  window: BrowserWindow,
  allowedUrl: string,
  photos: FotoService,
  registrar: Pick<typeof ipcMain, 'handle'> = ipcMain,
) {
  let selecting = false;
  const operations = {
    selecionar: async () => {
      if (selecting) throw new CadastroError('VALIDATION', 'Seleção já aberta');
      selecting = true;
      try {
        const result = await dialog.showOpenDialog(window, {
          title: 'Selecionar fotografia do produto',
          properties: ['openFile'],
          filters: [
            {
              name: 'Imagens de produtos — JPG, JPEG, JFIF, PNG e WebP',
              extensions: ['jpg', 'jpeg', 'jfif', 'png', 'webp'],
            },
          ],
        });
        if (result.canceled || !result.filePaths.length) return null;
        if (window.isDestroyed()) return null;
        return await photos.prepare(readSelectedFoto(result.filePaths[0]), window.webContents.id);
      } finally {
        selecting = false;
      }
    },
    descartar: (token: unknown) => photos.discard(token, window.webContents.id),
    obter: (input: unknown) => photos.obtain(input),
    salvar: (command: unknown) => photos.save(command, window.webContents.id),
    remover: (command: unknown) => photos.remove(command, window.webContents.id),
  };
  for (const name of Object.keys(CANAIS_FOTOS) as (keyof typeof CANAIS_FOTOS)[]) {
    registrar.handle(CANAIS_FOTOS[name], async (event, ...args: unknown[]) => {
      if (!isTrustedSender(event, window, allowedUrl))
        throw new Error('Operação IPC não autorizada.');
      try {
        if (args.length !== (name === 'selecionar' ? 0 : 1))
          throw new CadastroError('VALIDATION', 'Argumentos inválidos');
        return { ok: true, data: await operations[name](args[0]) };
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'EROFS', 'EBUSY'].includes(String(error.code))
        ) {
          photos.diagnostic({ phase: name, code: 'PHOTO_WRITE', cause: String(error.code) });
          return erroCadastro(new FotoError('PHOTO_WRITE'));
        }
        photos.diagnostic({
          phase: name,
          code: error instanceof FotoError ? error.code : 'PHOTO_OPERATION_FAILED',
        });
        return erroCadastro(error);
      }
    });
  }
}
