// External Electron harness. Real codec, pixels, persistence and original metadata.
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
    const { backupFixture } = require('../tests/helpers/backup-fixture.cjs');
    const { createFotoService } = require('../dist/electron/services/fotos');
    const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
    const results = [];
    const f = await backupFixture(undefined, true);
    let photos = createFotoService(f.db, f.images, 'compatibility', normalizeFoto);
    for (const c of JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'))) {
      const bytes = readSelectedFoto(path.join(root, c.name)),
        started = performance.now();
      let codec;
      const result = normalizeFoto(bytes, (event) => {
        codec = event;
      });
      assert.equal(result.size.width <= 2048, true);
      assert.equal(result.size.height <= 2048, true);
      assert(result.image.length <= 8 * 1024 * 1024);
      if (c.width <= 2048 && c.height <= 2048)
        assert.deepEqual(result.size, { width: c.width, height: c.height });
      assert(Math.max(result.thumbSize.width, result.thumbSize.height) <= 160);
      assert(!result.image.includes(Buffer.from('Exif\0\0')), 'EXIF/GPS retained');
      const image = nativeImage.createFromBuffer(result.image);
      assert(!image.isEmpty());
      if (c.reference) {
        const expected = nativeImage
          .createFromBuffer(fs.readFileSync(path.join(root, c.reference)))
          .toBitmap();
        const actual = image.toBitmap();
        assert.equal(actual.length, expected.length);
        let diff = 0;
        for (let i = 0; i < actual.length; i++) diff += Math.abs(actual[i] - expected[i]);
        assert(diff / actual.length < 5, 'Wrong orientation/pixels: ' + c.name);
      }
      if (c.name.startsWith('transparência')) assert.equal(image.toBitmap()[3], 0);
      if (c.name === 'cmyk.jpeg') {
        const pixel = image.toBitmap().subarray(0, 4); // BGRA red, not cyan/black.
        assert(pixel[2] > 200 && pixel[0] < 50 && pixel[1] < 50);
      }
      const prepared = await photos.prepare(bytes, 1);
      await photos.save(f.command({ produtoId: f.cycle.productId, token: prepared.token }), 1);
      assert.deepEqual(
        Buffer.from(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }).bytes),
        result.image,
      );
      results.push({
        name: c.name,
        bytes: bytes.length,
        size: result.size,
        outputBytes: result.image.length,
        ms: performance.now() - started,
        rss: process.memoryUsage().rss,
        codec,
      });
      fs.writeFileSync(path.join(root, 'normalized-' + path.basename(c.name)), result.image);
    }
    const prior = photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' });
    const beforeInvalid = snapshot(f.db);
    for (const [bytes, code] of [
      [Buffer.alloc(0), 'PHOTO_INVALID'],
      [Buffer.from('fake.jpg'), 'PHOTO_INVALID'],
      [Buffer.from('GIF89a'), 'PHOTO_FORMAT'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'PHOTO_FORMAT'],
      [Buffer.alloc(10 * 1024 * 1024 + 1), 'PHOTO_SIZE'],
      [fs.readFileSync(path.join(root, 'JPEG comum.jpg')).subarray(0, 100), 'PHOTO_INVALID'],
    ]) {
      await assert.rejects(photos.prepare(bytes, 1), (e) => e.code === code);
      assert.deepEqual(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }), prior);
    }
    const huge = fs.readFileSync(path.join(root, 'rgb.PNG'));
    huge.writeUInt32BE(9000, 16);
    assert.throws(
      () => normalizeFoto(huge),
      (e) => e.code === 'PHOTO_DIMENSIONS',
    );
    const badCrc = fs.readFileSync(path.join(root, 'rgb.PNG'));
    badCrc[badCrc.length - 1] ^= 1;
    assert.throws(
      () => normalizeFoto(badCrc),
      (e) => e.code === 'PHOTO_INVALID',
    );
    const badExif = fs.readFileSync(path.join(root, 'orientacao-6.JPG'));
    const tiff = badExif.indexOf(Buffer.from('Exif\0\0')) + 6;
    badExif.fill(255, tiff + 4, tiff + 8);
    assert.throws(
      () => normalizeFoto(badExif),
      (e) => e.code === 'PHOTO_INVALID',
    );
    assert.throws(
      () => readSelectedFoto(path.join(root, 'absent.jpg')),
      (e) => e.code === 'PHOTO_ACCESS',
    );
    const originalOpen = fs.openSync;
    fs.openSync = () => {
      throw Object.assign(Error('secret-user-path'), { code: 'EACCES' });
    };
    try {
      assert.throws(
        () => readSelectedFoto(path.join(root, 'rgb.PNG')),
        (e) => e.code === 'PHOTO_ACCESS' && !e.message.includes('secret'),
      );
    } finally {
      fs.openSync = originalOpen;
    }
    assert.equal(snapshot(f.db), beforeInvalid, 'Invalid images must not write any table');
    for (const failAt of [1, 2]) {
      const broken = createFotoService(f.db, f.images, 'test', normalizeFoto);
      const filesBefore = fs.readdirSync(path.join(f.images, 'staging'));
      const originalWrite = fs.writeSync;
      let writes = 0;
      fs.writeSync = (...args) => {
        if (++writes === failAt) throw Object.assign(Error('test disk full'), { code: 'ENOSPC' });
        return originalWrite(...args);
      };
      try {
        await assert.rejects(
          broken.prepare(fs.readFileSync(path.join(root, 'rgb.PNG')), 1),
          (e) => e.code === 'PHOTO_WRITE',
        );
      } finally {
        fs.writeSync = originalWrite;
      }
      assert.deepEqual(fs.readdirSync(path.join(f.images, 'staging')), filesBefore);
      assert.deepEqual(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }), prior);
    }
    assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
    photos = createFotoService(f.db, f.images, 'reopen', normalizeFoto);
    assert.deepEqual(await photos.reconcile(), { preserved: 0, missing: 0 });
    assert.deepEqual(photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }), prior);
    f.db.close();
    fs.writeFileSync(
      path.join(root, 'results.json'),
      JSON.stringify(
        {
          electron: process.versions.electron,
          results,
          root: f.root,
          maxRssKiB: process.resourceUsage().maxRSS,
        },
        null,
        2,
      ),
    );
    console.log('FOTOS_COMPATIBILIDADE_OK', results.length);
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
