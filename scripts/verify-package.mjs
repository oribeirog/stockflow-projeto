// Read-only inspection of the final ASAR; test artifacts must never ship.
import assert from 'node:assert/strict';
import { normalize } from 'node:path';
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
}
assert(files.includes('/dist/electron/preload/index.cjs'), 'Production preload missing');
assert(files.includes('/dist/electron/ipc/cadastros.js'), 'Production handlers missing');
assert(files.includes('/dist/electron/services/exportacoes/worker.js'), 'Export worker missing');
assert(files.includes('/node_modules/exceljs/excel.js'), 'XLSX library missing');
console.log('PACKAGE_ISOLATION_OK', renderer.length, 'production renderer bundles');
