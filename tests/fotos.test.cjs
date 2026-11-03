const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  readdirSync,
} = require('node:fs');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const { createFotoService } = require('../dist/electron/services/fotos.js');
const { imageHeader } = require('../dist/electron/services/foto-validation.js');
const Database = require('better-sqlite3');
const {
  migrations,
  migrateDatabase,
  inspectDatabase,
} = require('../dist/electron/infrastructure/database/migrate.js');
const {
  createMediaSnapshot,
  restoreMediaSnapshot,
} = require('../dist/electron/services/media-snapshot.js');
const cmd = (dados) => ({ operacaoId: randomUUID(), motivo: 'Teste de foto', dados });
async function fixture(t) {
  mkdirSync('.local-data/test', { recursive: true });
  const root = mkdtempSync(resolve('.local-data/test/fotos-'));
  const db = await openDatabase(root, 'test');
  t.after(() => db.close());
  const c = createCatalogService(db, 'test');
  const marca = c.saveReference('MARCA', cmd({ nome: 'Marca' })),
    categoria = c.saveReference('CATEGORIA', cmd({ nome: 'Categoria' }));
  const product = c.saveProduct(
    cmd({
      nome: 'Foto',
      sku: 'FOTO',
      marcaId: marca.id,
      categoriaId: categoria.id,
      volumeMicrolitros: 1000,
      precoVendaCentavos: 0,
      estoqueMinimo: 0,
    }),
  );
  let clock = Date.now(),
    failure = '';
  const normalize = (bytes) => ({
    mime: 'image/png',
    image: bytes,
    thumb: bytes,
    size: { width: 1, height: 1 },
    thumbSize: { width: 1, height: 1 },
  });
  const options = {
    now: () => clock,
    fault: (phase) => {
      if (phase === failure) throw new Error('interruption ' + phase);
    },
  };
  const photos = createFotoService(db, join(root, 'images'), 'test', normalize, options);
  return {
    root,
    db,
    product,
    photos,
    normalize,
    options,
    fail: (phase) => (failure = phase),
    expire: () => (clock += 31 * 60_000),
  };
}
test('signature and bounded header validation reject false types, truncated data, animations and pixel bombs', () => {
  for (const bytes of [
    Buffer.from('fake.png'),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    Buffer.alloc(10 * 1024 * 1024 + 1),
  ])
    assert.throws(
      () => imageHeader(bytes),
      (e) => e.code === 'PHOTO_INVALID',
    );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
    'base64',
  );
  assert.deepEqual(imageHeader(png), { mime: 'image/png', width: 1, height: 1 });
  const huge = Buffer.from(png);
  huge.writeUInt32BE(9000, 16);
  assert.throws(() => imageHeader(huge));
  const pixels = Buffer.from(png);
  pixels.writeUInt32BE(6000, 16);
  pixels.writeUInt32BE(6000, 20);
  assert.throws(() => imageHeader(pixels));
  const animated = Buffer.from(png);
  animated.write('acTL', 37);
  assert.throws(() => imageHeader(animated));
});
for (const phase of [
  'publish-image',
  'publish-thumb',
  'published',
  'before-commit',
  'after-commit',
  'cleanup',
])
  test(`photo replacement recovers interruption at ${phase} and never invalidates prior image before commit`, async (t) => {
    const f = await fixture(t),
      id = f.product.id;
    const old = await f.photos.prepare(Buffer.from('old'), 1);
    await f.photos.save(cmd({ produtoId: id, token: old.token }), 1);
    const next = await f.photos.prepare(Buffer.from('next'), 1),
      operation = cmd({ produtoId: id, token: next.token });
    f.fail(phase);
    const committed = ['after-commit', 'cleanup'].includes(phase);
    if (phase === 'cleanup') await f.photos.save(operation, 1);
    else await assert.rejects(f.photos.save(operation, 1), /interruption/);
    assert.equal(
      Buffer.from(f.photos.obtain({ produtoId: id, variante: 'imagem' }).bytes).toString(),
      committed ? 'next' : 'old',
    );
    if (!committed)
      assert.equal(
        readFileSync(join(f.root, 'images/objects', old.token + '.image'), 'utf8'),
        'old',
      );
    f.fail('');
    const saved = await f.photos.save(operation, 1);
    assert.equal(saved.fotoId, next.token);
    assert.deepEqual(await f.photos.save(operation, 1), saved);
    assert.equal(
      f.db
        .prepare('SELECT count(*) n FROM eventos_auditoria WHERE operacao_id=?')
        .get(operation.operacaoId).n,
      1,
    );
    await f.photos.reconcile();
    assert.equal(existsSync(join(f.root, 'images/objects', old.token + '.image')), false);
    const reopened = createFotoService(
      f.db,
      join(f.root, 'images'),
      'test',
      f.normalize,
      f.options,
    );
    await reopened.reconcile();
    assert.equal(reopened.obtain({ produtoId: id, variante: 'imagem' }).fotoId, next.token);
  });
test('expired/foreign tokens, discard, duplicated replies and uncertain cleanup preserve data', async (t) => {
  const f = await fixture(t),
    input = await f.photos.prepare(Buffer.from('photo'), 1);
  await assert.rejects(
    f.photos.save(cmd({ produtoId: f.product.id, token: input.token }), 2),
    (e) => e.code === 'PHOTO_EXPIRED',
  );
  await f.photos.discard(input.token, 2);
  assert.equal(existsSync(join(f.root, 'images/staging', input.token + '.image')), true);
  f.expire();
  await assert.rejects(
    f.photos.save(cmd({ produtoId: f.product.id, token: input.token }), 1),
    (e) => e.code === 'PHOTO_EXPIRED',
  );
  await f.photos.reconcile();
  assert.equal(existsSync(join(f.root, 'images/staging', input.token + '.image')), false);
  const live = await f.photos.prepare(Buffer.from('live'), 1);
  await f.photos.save(cmd({ produtoId: f.product.id, token: live.token }), 1);
  const operation = cmd({ produtoId: f.product.id });
  await f.photos.remove(operation, 1);
  await f.photos.remove(operation, 1);
  assert.equal(f.photos.obtain({ produtoId: f.product.id, variante: 'imagem' }), null);
  const unknown = join(f.root, 'images/objects/unknown.image');
  writeFileSync(unknown, 'preserve');
  const bad = await f.photos.prepare(Buffer.from('known'), 1);
  writeFileSync(join(f.root, 'images/staging', bad.token + '.image'), 'different');
  f.expire();
  const health = await f.photos.reconcile();
  assert.ok(health.preserved >= 2);
  assert.equal(existsSync(unknown), true);
  assert.equal(existsSync(join(f.root, 'images/staging', bad.token + '.image')), true);
});
test('missing linked photo is reported without deleting its database link', async (t) => {
  const f = await fixture(t),
    photo = await f.photos.prepare(Buffer.from('live'), 1);
  await f.photos.save(cmd({ produtoId: f.product.id, token: photo.token }), 1);
  writeFileSync(join(f.root, 'images/objects', photo.token + '.image'), 'corrupt');
  assert.equal((await f.photos.reconcile()).missing, 1);
  assert.throws(
    () => f.photos.obtain({ produtoId: f.product.id, variante: 'imagem' }),
    (e) => e.code === 'PHOTO_UNAVAILABLE',
  );
  assert.equal(f.db.prepare('SELECT foto_id FROM produto_fotos').get().foto_id, photo.token);
});
for (const version of [1, 2, 3, 4])
  test(`0005 upgrade preserves populated v${version} catalogs, identity and immutable history`, async () => {
    mkdirSync('.local-data/test', { recursive: true });
    const directory = mkdtempSync(resolve('.local-data/test/photo-upgrade-'));
    const db = new Database(join(directory, 'db.sqlite'));
    db.pragma('foreign_keys=ON');
    db.pragma('trusted_schema=OFF');
    db.pragma('journal_mode=WAL');
    try {
      await migrateDatabase(
        db,
        { directory, existed: false, appVersion: 'test' },
        migrations.slice(0, version),
      );
      const c = createCatalogService(db, 'test'),
        brand = c.saveReference('MARCA', cmd({ nome: 'Preservar marca' })),
        category = c.saveReference('CATEGORIA', cmd({ nome: 'Preservar categoria' }));
      c.saveProduct(
        cmd({
          nome: 'Preservar perfume',
          sku: 'UPGRADE',
          marcaId: brand.id,
          categoriaId: category.id,
          volumeMicrolitros: 100125,
          precoVendaCentavos: 12345,
          estoqueMinimo: 7,
          codigoBarras: '000123',
        }),
      );
      const tables = [
        'produtos',
        'marcas',
        'categorias',
        'historico_precos',
        'eventos_auditoria',
        'operacoes',
        'metadados_banco',
      ];
      const before = Object.fromEntries(
        tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
      );
      const history = db.prepare('SELECT * FROM schema_migrations ORDER BY versao').all();
      await migrateDatabase(db, { directory, existed: true, appVersion: '4B' });
      assert.equal(inspectDatabase(db).version, 5);
      for (const [table, rows] of Object.entries(before))
        assert.deepEqual(
          db.prepare(`SELECT ${Object.keys(rows[0]).join(',')} FROM ${table} ORDER BY 1`).all(),
          rows,
        );
      assert.deepEqual(
        db.prepare('SELECT * FROM schema_migrations ORDER BY versao').all().slice(0, version),
        history,
      );
      assert.equal(db.prepare('SELECT count(*) n FROM produto_fotos').get().n, 0);
    } finally {
      db.close();
    }
  });
test('complete media snapshot serializes concurrent replacement and restores without access to either origin', async (t) => {
  const f = await fixture(t),
    first = await f.photos.prepare(Buffer.from('snapshot photo'), 1);
  await f.photos.save(cmd({ produtoId: f.product.id, token: first.token }), 1);
  const second = await f.photos.prepare(Buffer.from('concurrent replacement'), 1);
  let replacement,
    finished = false;
  const snapshot = await createMediaSnapshot(
    f.db,
    f.photos,
    join(f.root, 'snapshot'),
    '4B',
    async () => {
      replacement = f.photos
        .save(cmd({ produtoId: f.product.id, token: second.token }), 1)
        .then(() => (finished = true));
      await Promise.resolve();
      assert.equal(finished, false, 'Photo mutation must wait for the snapshot lock');
    },
  );
  await replacement;
  assert.equal(finished, true);
  assert.equal(
    f.photos.obtain({ produtoId: f.product.id, variante: 'imagem' }).fotoId,
    second.token,
  );
  const manifest = JSON.parse(readFileSync(join(snapshot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 3);
  assert.equal(manifest.files.filter((file) => file.path.includes(first.token)).length, 2);
  const restored = restoreMediaSnapshot(snapshot, join(f.root, 'restored'));
  // Both source folders become unavailable before opening the restored copy.
  for (const [from, to] of [
    [snapshot, join(f.root, 'snapshot-offline')],
    [join(f.root, 'images'), join(f.root, 'images-offline')],
  ]) {
    assert.ok(resolve(from).startsWith(resolve(f.root) + require('node:path').sep));
    assert.ok(resolve(to).startsWith(resolve(f.root) + require('node:path').sep));
    renameSync(from, to);
  }
  const restoredDb = await openDatabase(
    join(restored, 'data'),
    'test',
    undefined,
    join(restored, 'images'),
  );
  t.after(() => restoredDb.close());
  const photos = createFotoService(restoredDb, join(restored, 'images'), 'test', f.normalize);
  assert.deepEqual(await photos.reconcile(), { preserved: 0, missing: 0 });
  for (const variant of ['imagem', 'miniatura'])
    assert.equal(
      Buffer.from(photos.obtain({ produtoId: f.product.id, variante: variant }).bytes).toString(),
      'snapshot photo',
    );
  assert.deepEqual(createCatalogService(restoredDb, 'test').getProduct(f.product.id), f.product);
  assert.equal(inspectDatabase(restoredDb).identity.identificador, manifest.databaseId);
});
test('backup fails closed for unavailable images; restore rejects corruption, traversal and existing destinations', async (t) => {
  const f = await fixture(t),
    staged = await f.photos.prepare(Buffer.from('complete'), 1);
  await f.photos.save(cmd({ produtoId: f.product.id, token: staged.token }), 1);
  const snapshot = await createMediaSnapshot(f.db, f.photos, join(f.root, 'snapshot'), '4B');
  assert.throws(() => restoreMediaSnapshot(snapshot, snapshot), /diretório novo/);
  const manifestPath = join(snapshot, 'manifest.json'),
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const original = readFileSync(manifestPath);
  manifest.files[1].path = '../../outside';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => restoreMediaSnapshot(snapshot, join(f.root, 'rejected')));
  assert.equal(existsSync(join(f.root, 'rejected')), false);
  writeFileSync(manifestPath, original);
  writeFileSync(join(snapshot, 'images/objects', staged.token + '.image'), 'corrupt');
  assert.throws(() => restoreMediaSnapshot(snapshot, join(f.root, 'rejected')), /Hash/);
  writeFileSync(join(f.root, 'images/objects', staged.token + '.image'), 'corrupt');
  await assert.rejects(createMediaSnapshot(f.db, f.photos, join(f.root, 'invalid-backup'), '4B'));
  assert.equal(existsSync(join(f.root, 'invalid-backup')), false);
});
test('future pre-migration backup includes independently restorable v5 images and manifest', async (t) => {
  const f = await fixture(t),
    staged = await f.photos.prepare(Buffer.from('pre migration'), 1);
  await f.photos.save(cmd({ produtoId: f.product.id, token: staged.token }), 1);
  await migrateDatabase(
    f.db,
    {
      directory: f.root,
      imagesDirectory: join(f.root, 'images'),
      existed: true,
      appVersion: 'test',
    },
    [
      ...migrations,
      { version: 6, name: 'fixture6', sql: 'CREATE TABLE fixture6(id INTEGER) STRICT;' },
    ],
  );
  const folder = readdirSync(join(f.root, 'backups')).find((name) => name.endsWith('.assets'));
  assert.ok(folder);
  const restored = restoreMediaSnapshot(join(f.root, 'backups', folder), join(f.root, 'restored'));
  const db = await openDatabase(join(restored, 'data'), 'test');
  t.after(() => db.close());
  assert.equal(
    createFotoService(db, join(restored, 'images'), 'test', f.normalize).obtain({
      produtoId: f.product.id,
      variante: 'imagem',
    }).fotoId,
    staged.token,
  );
});
