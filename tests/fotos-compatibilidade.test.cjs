const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

test('Pré-5.2 B: real Electron normalizes photographic variants, EXIF pixels, colours, alpha, limits and failed preparation', () => {
  const r = spawnSync(process.execPath, ['scripts/fotos-compatibilidade.mjs'], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /FOTOS_COMPATIBILIDADE_OK 26/);
});

test('Pré-5.2 B: public branding preserves technical storage, recovery ownership and backup identity', () => {
  const text = (p) => fs.readFileSync(p, 'utf8');
  assert.match(text('electron-builder.yml'), /^appId: br\.com\.mnrsoftware\.mnrperfumes$/m);
  assert.match(text('electron-builder.yml'), /^productName: MNR Gestão$/m);
  assert.match(text('electron/infrastructure/paths/index.ts'), /'MNR Software', 'MNR Perfumes'/);
  assert.match(text('electron/services/backup/control.ts'), /app: 'MNR Perfumes'/);
  assert.match(
    text('electron/services/backup/format.ts'),
    /BACKUP_APP = 'br\.com\.mnrsoftware\.mnrperfumes'/,
  );
  assert.match(text('electron/main/index.ts'), /app\.setName\('MNR Gestão'\)/);
  for (const p of [
    'src/index.html',
    'src/app/core/navigation.ts',
    'src/app/core/shell/shell.html',
    'electron/services/exportacoes/html.ts',
    'electron/services/exportacoes/xlsx.ts',
  ]) {
    assert(text(p).includes('MNR Gestão'), p);
    assert(!text(p).includes('MNR Perfumes'), p);
  }
});
