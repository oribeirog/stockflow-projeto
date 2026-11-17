// Read-only inspection of the final ASAR; test artifacts must never ship.
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { listPackage, extractFile } from '@electron/asar';
const archive = process.argv[2] ?? 'release/win-unpacked/resources/app.asar';
const files = listPackage(archive).map((file) => file.replaceAll('\\', '/'));
assert(
  !files.some((file) => /^\/(tests|scripts|\.cache)(\/|$)/.test(file)),
  'Test entry/scripts/cache included',
);
const renderer = files.filter((file) => /^\/dist\/renderer\/browser\/.*\.js$/.test(file));
assert(renderer.length > 0, 'Production renderer missing');
for (const file of renderer) {
  const text = extractFile(archive, normalize(file.slice(1))).toString();
  assert(
    !text.includes('CADASTROS_ANGULAR_OK') && !text.includes('Resposta perdida no teste'),
    'Integration fixture shipped',
  );
  assert(!text.includes('MNR Perfumes'), 'Old public brand in current renderer');
}
assert(files.includes('/dist/electron/preload/index.cjs'), 'Production preload missing');
assert(files.includes('/dist/electron/ipc/cadastros.js'), 'Production handlers missing');
assert(files.includes('/dist/electron/services/foto-orientation.js'), 'Photo orientation missing');
assert(files.includes('/dist/electron/services/foto-diagnostics.js'), 'Photo diagnostics missing');
assert(files.includes('/dist/electron/services/foto-webp.js'), 'WebP normalization missing');
assert(files.includes('/node_modules/sharp/dist/index.cjs'), 'Sharp decoder missing');
assert(files.includes('/node_modules/sharp/LICENSE'), 'Sharp license missing');
assert(
  files.includes('/node_modules/@img/sharp-win32-x64/LICENSE'),
  'Windows decoder license missing',
);
for (const file of ['sharp-win32-x64-0.35.5.node', 'libvips-42.dll', 'libvips-cpp-8.18.7.dll']) {
  assert(
    existsSync(archive + '.unpacked/node_modules/@img/sharp-win32-x64/lib/' + file),
    'Unpacked Windows decoder missing: ' + file,
  );
}
assert(
  extractFile(archive, 'package.json').toString().includes('MNR Gestão'),
  'Public package description missing',
);
assert(files.includes('/dist/electron/services/exportacoes/worker.js'), 'Export worker missing');
assert(files.includes('/node_modules/exceljs/excel.js'), 'XLSX library missing');
assert(files.includes('/dist/electron/services/backup/worker.js'), 'Backup worker missing');
for (const file of [
  '/dist/shared/backup-policy.js',
  '/dist/electron/ipc/backup-recorrente.js',
  '/dist/electron/services/backup/policy-store.js',
  '/dist/electron/services/backup/recurring.js',
])
  assert(files.includes(file), 'Recurring backup module missing: ' + file);
for (const file of [
  'dist/shared/backup-policy.js',
  'dist/electron/main/index.js',
  'dist/electron/preload/index.cjs',
  'dist/electron/ipc/backup-recorrente.js',
  'dist/electron/services/backup/controller.js',
  'dist/electron/services/backup/policy-store.js',
  'dist/electron/services/backup/recurring.js',
])
  assert.deepEqual(
    extractFile(archive, normalize(file)),
    readFileSync(file),
    'Stale packaged module: ' + file,
  );
for (const file of files.filter((file) => /^\/dist\/.*\.(js|cjs)$/.test(file))) {
  const source = extractFile(archive, normalize(file.slice(1))).toString();
  assert(!source.includes('__policyDay'), 'Test clock shipped: ' + file);
}
assert(files.includes('/node_modules/yauzl/index.js'), 'Backup ZIP reader missing');
assert(files.includes('/node_modules/yazl/index.js'), 'Backup ZIP writer missing');
assert(
  files.includes('/dist/electron/infrastructure/database/migrations/0006-catalogo-generalista.js'),
  'Universal catalog migration missing',
);
assert(
  files.includes('/dist/electron/infrastructure/database/sqlite-path.js'),
  'SQLite path support missing',
);
console.log('PACKAGE_ISOLATION_OK', renderer.length, 'production renderer bundles');
