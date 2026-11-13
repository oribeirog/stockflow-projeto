import type { app } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeDirectory } from '../services/backup/io';

// The development supervisor owns Angular and its child Electron processes.
// An ordinary app.relaunch would orphan Electron while the supervisor stops HTTP.
export function relaunchApplication(
  application: Pick<typeof app, 'isPackaged' | 'relaunch' | 'quit'>,
  host: Pick<NodeJS.Process, 'env' | 'send' | 'connected' | 'on' | 'removeListener'> = process,
) {
  const standalone = () => {
    application.relaunch();
    application.quit();
  };
  if (
    !application.isPackaged &&
    host.env['MNR_DEV'] === '1' &&
    host.env['MNR_DEV_SUPERVISED'] === '1' &&
    host.connected &&
    host.send
  ) {
    let finished = false;
    const finish = (supervisorReady: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      host.removeListener('message', ready);
      if (!supervisorReady)
        console.error(
          'Supervisor de desenvolvimento não confirmou o reinício; intenção preservada para a próxima abertura.',
        );
      // Never start an orphan second process on timeout: the supervisor may
      // already own the restart. The durable restore intent survives quitting.
      application.quit();
    };
    const ready = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        Object.keys(message).length === 1 &&
        'type' in message &&
        message.type === 'mnr:relaunch-ready'
      )
        finish(true);
    };
    const timer = setTimeout(() => finish(false), 5000);
    host.on('message', ready);
    host.send({ type: 'mnr:relaunch' }, undefined, undefined, (error) => {
      if (error) finish(false);
    });
  } else standalone();
}

export type StartupPhase = 'recovery' | 'photos' | 'interface' | 'ready';
export async function recordStartupError(
  error: unknown,
  phase: StartupPhase,
  root: string,
  logs: string,
) {
  const e = error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown } | null;
  const redact = (value: unknown, limit: number) => {
    let text = String(value ?? '').slice(0, limit);
    for (const [path, token] of [
      [root, '<dados>'],
      [process.cwd(), '<app>'],
      [process.env['USERPROFILE'], '<usuario>'],
    ])
      if (path) {
        text = text.replaceAll(path, token!);
        text = text.replaceAll(path.replaceAll('\\', '/'), token!);
      }
    return text.replace(/\b[A-Za-z]:[\\/][^\r\n)]+/g, '<caminho local>');
  };
  const entry = {
    createdAt: new Date().toISOString(),
    phase,
    pid: process.pid,
    name: redact(e?.name, 100),
    code: redact(e?.code, 100),
    message: redact(e?.message ?? error, 4096),
    stack: redact(e?.stack, 12288),
  };
  console.error('Falha de inicialização:', JSON.stringify(entry));
  try {
    await safeDirectory(logs);
    await writeFile(
      join(logs, `startup-error-${Date.now()}-${randomUUID()}.json`),
      JSON.stringify(entry, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  } catch {
    console.error('Registro local de inicialização indisponível; dados preservados.');
  }
}
