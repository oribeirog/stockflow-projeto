import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function preparePaths() {
  const testRun = process.env['MNR_UI_TEST_RUN'];
  if (testRun && (app.isPackaged || !/^ui-[a-zA-Z0-9_-]+$/.test(testRun)))
    throw new Error('Execução de teste inválida.');
  const root = testRun
    ? join(process.cwd(), '.local-data', 'test', testRun)
    : app.isPackaged && process.env['MNR_SMOKE'] !== '1'
      ? join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), 'MNR Software', 'MNR Perfumes')
      : join(
          process.cwd(),
          '.local-data',
          process.env['MNR_SMOKE'] === '1' ? 'test' : 'development',
        );
  const paths = {
    root,
    data: join(root, 'data'),
    images: join(root, 'images'),
    logs: join(root, 'logs'),
  };
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
  mkdirSync(join(root, 'chromium'), { recursive: true });
  app.setPath('userData', root);
  app.setPath('sessionData', join(root, 'chromium'));
  return paths;
}
