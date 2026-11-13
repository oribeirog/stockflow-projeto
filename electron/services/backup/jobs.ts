import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { BackupError } from './io';
export type BackupTask =
  | { task: 'capture'; database: string; images: string; target: string; version: string }
  | { task: 'package' | 'inspect'; source: string; target: string }
  | { task: 'validate'; source: string };
export function backupJob<T>(task: BackupTask): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'worker.js'), {
      workerData: task,
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32 },
    });
    let done = false;
    const timer = setTimeout(() => finish(new BackupError('LIMIT')), 30 * 60 * 1000);
    function finish(error?: unknown, data?: T) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate().then(() => {
        if (error) reject(error);
        else resolve(data!);
      });
    }
    worker.once('message', (r) =>
      r.ok ? finish(undefined, r.data) : finish(new BackupError(r.error.code)),
    );
    worker.once('error', (e) =>
      finish(
        new BackupError(
          (e as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? 'LIMIT'
            : 'BACKUP_FAILED',
        ),
      ),
    );
    worker.once('exit', (code) => {
      if (!done) finish(new BackupError(code ? 'BACKUP_FAILED' : 'INVALID_BACKUP'));
    });
  });
}
