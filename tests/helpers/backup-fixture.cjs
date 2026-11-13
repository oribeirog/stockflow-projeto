const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createFotoService } = require('../../dist/electron/services/fotos');
const { stockCycle, command } = require('./consolidacao-estoque-fixture.cjs');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
async function backupFixture(t, full = true, options = {}) {
  fs.mkdirSync('.local-data/test', { recursive: true });
  const root = options.root ?? fs.mkdtempSync(resolve('.local-data/test/backup-')),
    data = join(root, 'data'),
    images = join(root, 'images');
  fs.mkdirSync(data);
  fs.mkdirSync(images);
  const db = await openDatabase(data, 'test');
  t?.after(() => {
    if (db.open) db.close();
  });
  const normalize = (bytes) => ({
    mime: 'image/png',
    image: bytes,
    thumb: bytes,
    size: { width: 1, height: 1 },
    thumbSize: { width: 1, height: 1 },
  });
  const photos = createFotoService(db, images, 'test', normalize);
  let cycle;
  if (full) {
    cycle = stockCycle(db);
    for (const [, run] of cycle.steps) run();
    const token = await photos.prepare(png, 7);
    await photos.save(command({ produtoId: cycle.productId, token: token.token }), 7);
  }
  const outputs = fs.mkdtempSync(resolve('.local-data/test/backup-outputs-'));
  return { root, data, images, db, photos, cycle, outputs, png, normalize, command, randomUUID };
}
module.exports = { backupFixture, png };
