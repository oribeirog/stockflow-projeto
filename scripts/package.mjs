import { spawnSync } from 'node:child_process';
import { environment } from './env.mjs';
const result = spawnSync(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--win',
    '--x64',
    '--publish',
    'never',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: environment() },
);
process.exit(result.status ?? 1);
