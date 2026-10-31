import { spawnSync } from 'node:child_process';
import { environment } from './env.mjs';
// Electron 43 requires an explicit binary download; better-sqlite3 13 ships Node-API prebuilds.
const result = spawnSync(process.execPath, ['node_modules/electron/install.js'], {
  stdio: 'inherit',
  env: environment(),
});
if (result.status !== 0) process.exit(result.status ?? 1);
const { default: Database } = await import('better-sqlite3');
const db = new Database(':memory:');
db.prepare('SELECT 1').get();
db.close();
