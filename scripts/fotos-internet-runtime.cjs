const { app, nativeImage } = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(process.argv[2]);
assert(root.startsWith(path.resolve('.cache') + path.sep));
app.setPath('userData', fs.mkdtempSync(path.join(root, 'profile-')));
app
  .whenReady()
  .then(async () => {
    const { normalizeFoto } = require('../dist/electron/services/foto-codec');
    const { readSelectedFoto } = require('../dist/electron/ipc/fotos');
    const { webpHeader } = require('../dist/electron/services/foto-webp');
    const { backupFixture } = require('../tests/helpers/backup-fixture.cjs');
    const { createFotoService } = require('../dist/electron/services/fotos');
    const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
    const f = await backupFixture(undefined, true),
      results = [];
    let photos = createFotoService(f.db, f.images, 'internet', normalizeFoto);
    for (const c of JSON.parse(fs.readFileSync(path.join(root, 'internet-cases.json'), 'utf8'))) {
      const bytes = readSelectedFoto(path.join(root, c.name)),
        start = performance.now();
      const r = await normalizeFoto(bytes);
      assert.equal(r.mime, c.alpha ? 'image/png' : 'image/jpeg');
      assert.equal(r.size.width <= 2048 && r.size.height <= 2048, true);
      if (Math.max(c.width, c.height) <= 2048)
        assert.deepEqual(r.size, { width: c.width, height: c.height });
      assert(!nativeImage.createFromBuffer(r.thumb).isEmpty());
      assert(Math.max(r.thumbSize.width, r.thumbSize.height) <= 160);
      if (c.alpha) assert.equal(nativeImage.createFromBuffer(r.image).toBitmap()[3], 0);
      assert(!r.image.includes(Buffer.from('Exif\0\0')));
      const p = await photos.prepare(bytes, 1);
      await photos.save(f.command({ produtoId: f.cycle.productId, token: p.token }), 1);
      assert.deepEqual(
        Buffer.from(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }).bytes),
        r.image,
      );
      fs.writeFileSync(path.join(root, 'normalized-' + path.basename(c.name)), r.image);
      results.push({
        name: c.name,
        bytes: bytes.length,
        mime: r.mime,
        size: r.size,
        ms: performance.now() - start,
        rss: process.memoryUsage().rss,
      });
    }
    const before = snapshot(f.db),
      prior = photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' });
    for (const [name, code] of [
      ['recusado.gif', 'PHOTO_FORMAT'],
      ['recusado.avif', 'PHOTO_FORMAT'],
      ['animado.webp', 'PHOTO_FORMAT'],
      ['dimensoes.webp', 'PHOTO_DIMENSIONS'],
      ['falso.webp', 'PHOTO_INVALID'],
      ['truncado.webp', 'PHOTO_INVALID'],
    ]) {
      await assert.rejects(
        photos.prepare(fs.readFileSync(path.join(root, name)), 1),
        (e) => e.code === code,
        name,
      );
      assert.equal(snapshot(f.db), before);
    }
    const valid = fs.readFileSync(path.join(root, 'produto lossy.webp'));
    const malformed = Buffer.from(valid);
    malformed.fill(0, 20);
    await assert.rejects(photos.prepare(malformed, 1), (e) => e.code === 'PHOTO_INVALID');
    // Keep a valid RIFF and VP8L header, but remove every entropy byte.
    const corrupt = Buffer.concat([
      fs.readFileSync(path.join(root, 'produto lossless.webp')).subarray(0, 25),
      Buffer.alloc(1),
    ]);
    corrupt.writeUInt32LE(18, 4);
    corrupt.writeUInt32LE(5, 16);
    await assert.rejects(
      photos.prepare(corrupt, 1),
      (e) => e.code === 'PHOTO_INVALID' || e.code === 'PHOTO_PROCESSING',
    );
    assert.throws(
      () => webpHeader(Buffer.alloc(10 * 1024 * 1024 + 1)),
      (e) => e.code === 'PHOTO_SIZE',
    );
    const expanded = Buffer.from(valid);
    expanded.writeUInt16LE(6000, 26);
    expanded.writeUInt16LE(5000, 28);
    assert.throws(
      () => webpHeader(expanded),
      (e) => e.code === 'PHOTO_DIMENSIONS',
    );
    assert.equal(snapshot(f.db), before);
    photos = createFotoService(f.db, f.images, 'reopen', normalizeFoto);
    assert.deepEqual(await photos.reconcile(), { preserved: 0, missing: 0 });
    assert.deepEqual(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }), prior);
    // The existing backup lock must wait for asynchronous WebP normalization,
    // including both durable staged files. No half-prepared snapshot is allowed.
    let release, entered;
    const gate = new Promise((r) => {
      release = r;
    });
    const ready = new Promise((r) => {
      entered = r;
    });
    const coordinated = createFotoService(f.db, f.images, 'coordination', async (bytes) => {
      entered();
      await gate;
      return normalizeFoto(bytes);
    });
    const preparing = coordinated.prepare(valid, 1);
    await ready;
    let captured = false;
    const capture = coordinated.withLock(() => {
      captured = true;
      const row = f.db
        .prepare(
          "SELECT * FROM foto_arquivos WHERE estado='PREPARADA' ORDER BY criado_em DESC LIMIT 1",
        )
        .get();
      assert(row);
      for (const variant of ['image', 'thumb'])
        assert(fs.statSync(path.join(f.images, 'staging', row.id + '.' + variant)).size > 0);
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(captured, false);
    release();
    const prepared = await preparing;
    await capture;
    assert.equal(captured, true);
    await coordinated.discard(prepared.token, 1);
    // Sites may serve WebP with a JPEG-looking filename. Content, not suffix,
    // determines conversion; exercise the same bounded reader as the dialog.
    const misnamed = path.join(root, 'download com nome JPEG.JPG');
    fs.writeFileSync(misnamed, valid);
    const renamedSelection = await photos.prepare(readSelectedFoto(misnamed), 1);
    assert.equal(renamedSelection.previa.mime, 'image/jpeg');
    await photos.discard(renamedSelection.token, 1);
    assert.deepEqual(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }), prior);
    const staged = path.join(f.images, 'staging'),
      held = staged + '-held';
    const target = path.join(f.root, 'controlled-escape');
    for (const p of [staged, held, target])
      assert(path.resolve(p).startsWith(path.resolve(f.root) + path.sep));
    fs.mkdirSync(target);
    const beforeDirectorySwap = snapshot(f.db);
    const swapping = createFotoService(f.db, f.images, 'directory-swap', async (bytes) => {
      const result = await normalizeFoto(bytes);
      fs.renameSync(staged, held);
      fs.symlinkSync(target, staged, 'junction');
      return result;
    });
    try {
      await assert.rejects(swapping.prepare(valid, 1), (e) => e.code === 'PHOTO_UNAVAILABLE');
      assert.equal(snapshot(f.db), beforeDirectorySwap);
      assert.deepEqual(fs.readdirSync(target), []);
    } finally {
      if (fs.existsSync(held)) {
        assert(fs.lstatSync(staged).isSymbolicLink());
        fs.unlinkSync(staged);
        fs.renameSync(held, staged);
      }
    }
    assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
    f.db.close();
    fs.writeFileSync(
      path.join(root, 'internet-results.json'),
      JSON.stringify(
        { results, versions: require('sharp').versions, maxRssKiB: process.resourceUsage().maxRSS },
        null,
        2,
      ),
    );
    console.log('FOTOS_INTERNET_OK', results.length);
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
