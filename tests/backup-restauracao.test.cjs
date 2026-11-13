const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { backupFixture } = require('./helpers/backup-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const {
  captureSet,
  validateSet,
  packageSet,
  readArchive,
  inspectArchive,
} = require('../dist/electron/services/backup/format');
const {
  newOwnedSet,
  recoverAndOpen,
  armRestore,
  selection,
  recoveryPaths,
} = require('../dist/electron/services/backup/control');
const { hashFile } = require('../dist/electron/services/backup/io');
const { BackupController } = require('../dist/electron/services/backup/controller');
test('5.1 empty WAL snapshot, structural manifest, exact schema and no source writes', async (t) => {
  const f = await backupFixture(t, false),
    before = snapshot(f.db),
    owned = await newOwnedSet(f.root, 'work');
  const info = await captureSet(f.db.name, f.images, owned.path, 'test');
  assert.equal(info.produtos, 0);
  assert.equal(info.fotografias, 0);
  assert.equal(snapshot(f.db), before);
  const archive = join(f.outputs, 'vazio.mnrbackup');
  await packageSet(owned.path, archive);
  assert.equal((await readArchive(archive)).schema, 5);
  const restore = await newOwnedSet(f.root, 'sets');
  assert.equal((await inspectArchive(archive, restore.path)).produtos, 0);
  assert.equal(await selection(f.root), null);
});
test('5.1 complete financial/stock/photo cycle survives WAL backup, change, restore and second reopen', async (t) => {
  const f = await backupFixture(t),
    before = snapshot(f.db),
    sequences = f.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  let save = join(f.outputs, 'completo.mnrbackup'),
    open,
    requested = 0;
  const controller = new BackupController({
    root: f.root,
    db: f.db,
    photos: f.photos,
    version: 'test',
    protectedRoots: [f.root],
    chooseBackup: async () => save,
    chooseRestore: async () => open,
    restart: () => requested++,
    openProtections: async () => {},
  });
  const result = await controller.create();
  assert(result.bytes > 0);
  assert.equal(snapshot(f.db), before);
  f.cycle.stock.registrarEntrada(
    f.cycle.stockCommand({ produtoId: f.cycle.manual.id, quantidade: 3, custoTotalCentavos: 17 }),
  );
  await f.photos.remove(f.command({ produtoId: f.cycle.productId }), 7);
  const changed = snapshot(f.db);
  assert.notEqual(changed, before);
  open = save;
  const review = await controller.inspect();
  assert.equal(review.fotografias, 1);
  assert.equal(snapshot(f.db), changed);
  await controller.discard({ token: review.token });
  assert.equal(snapshot(f.db), changed);
  const confirmed = await controller.inspect();
  assert.deepEqual(await controller.restore({ token: confirmed.token, confirmacao: 'RESTAURAR' }), {
    reiniciando: true,
  });
  assert.equal(requested, 1);
  assert.deepEqual(await controller.restore({ token: confirmed.token, confirmacao: 'RESTAURAR' }), {
    reiniciando: true,
  });
  assert.equal(requested, 1);
  assert.equal(snapshot(f.db), changed);
  f.db.close();
  const active = await recoverAndOpen(f.root, 'test');
  assert.equal(snapshot(active.db), before);
  assert.deepEqual(
    active.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
    sequences,
  );
  const { createFotoService } = require('../dist/electron/services/fotos');
  const recovered = createFotoService(active.db, active.images, 'test', f.normalize);
  assert.deepEqual(
    Buffer.from(recovered.obtain({ produtoId: f.cycle.productId, variante: 'imagem' }).bytes),
    f.png,
  );
  assert.equal(active.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(active.db.pragma('foreign_key_check'), []);
  active.db.close();
  const again = await recoverAndOpen(f.root, 'test');
  assert.equal(snapshot(again.db), before);
  again.db.close();
  const protectedFile = join(recoveryPaths(f.root).protection, confirmed.token + '.mnrbackup'),
    protection = await newOwnedSet(f.root, 'work');
  await inspectArchive(protectedFile, protection.path);
  const Database = require('better-sqlite3'),
    old = new Database(join(protection.path, 'data/mnr-perfumes.db'), { readonly: true });
  assert.equal(snapshot(old), changed);
  old.close();
});

async function craftedZip(path, files) {
  const yazl = require('yazl'),
    { pipeline } = require('node:stream/promises'),
    zip = new yazl.ZipFile(),
    done = pipeline(zip.outputStream, fs.createWriteStream(path, { flags: 'wx' }));
  for (const f of files)
    zip.addBuffer(f.bytes, f.name, { compress: f.compress ?? false, mode: f.mode ?? 0o100600 });
  zip.end();
  await done;
}
test('5.1 hostile containers and manifests never modify the active database or photos', async (t) => {
  const f = await backupFixture(t),
    work = await newOwnedSet(f.root, 'work');
  await captureSet(f.db.name, f.images, work.path, 'test');
  const { encodeManifest } = require('../dist/electron/services/backup/format'),
    manifest = (await validateSet(work.path)).manifest;
  const files = [
    { name: 'manifest.json', bytes: fs.readFileSync(join(work.path, 'manifest.json')) },
    ...manifest.files.map((p) => ({
      name: p.path,
      bytes: fs.readFileSync(join(work.path, p.path)),
    })),
  ];
  const variants = [
    [
      'unknown-app',
      [{ ...files[0], bytes: encodeManifest({ ...manifest, app: 'outro' }) }, ...files.slice(1)],
    ],
    [
      'future-format',
      [{ ...files[0], bytes: encodeManifest({ ...manifest, format: 2 }) }, ...files.slice(1)],
    ],
    [
      'future-schema',
      [{ ...files[0], bytes: encodeManifest({ ...manifest, schema: 6 }) }, ...files.slice(1)],
    ],
    ['missing-manifest', files.slice(1)],
    ['missing-db', files.filter((p) => !p.name.startsWith('data/'))],
    ['missing-photo', files.slice(0, -1)],
    ['duplicate', [...files, files[1]]],
    [
      'extra',
      [
        ...files,
        {
          name: 'images/objects/11111111-1111-4111-8111-111111111111.image',
          bytes: Buffer.from('extra'),
        },
      ],
    ],
    ['symlink', [files[0], { ...files[1], mode: 0o120777 }, ...files.slice(2)]],
    ['compressed', [files[0], { ...files[1], compress: true }, ...files.slice(2)]],
    [
      'wrong-hash',
      [files[0], { ...files[1], bytes: Buffer.from('SQLite format corrupted') }, ...files.slice(2)],
    ],
    [
      'noncanonical-manifest',
      [
        { ...files[0], bytes: Buffer.concat([files[0].bytes, Buffer.from('\n')]) },
        ...files.slice(1),
      ],
    ],
  ];
  const before = snapshot(f.db),
    photoHash = await hashFile(
      join(
        f.images,
        'objects',
        f.db.prepare('SELECT foto_id FROM produto_fotos').get().foto_id + '.image',
      ),
    );
  for (const [label, entries] of variants) {
    const file = join(f.outputs, label + '.mnrbackup');
    await craftedZip(file, entries);
    const target = await newOwnedSet(f.root, 'sets');
    await assert.rejects(() => inspectArchive(file, target.path), undefined, label);
    assert.equal(snapshot(f.db), before);
    assert.equal(await selection(f.root), null);
  }
  const original = join(f.outputs, 'good.mnrbackup');
  await packageSet(work.path, original);
  const bytes = fs.readFileSync(original);
  // Alter central directory declarations only: reject oversized entries before
  // allocation/extraction, and reject a CRC that contradicts otherwise valid bytes.
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let central = bytes.readUInt32LE(end + 16);
  while (bytes.readUInt32LE(central) === 0x02014b50) {
    const length = bytes.readUInt16LE(central + 28),
      name = bytes.subarray(central + 46, central + 46 + length).toString();
    if (name.endsWith('.image')) break;
    central += 46 + length + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  for (const mode of ['oversized', 'crc']) {
    const tampered = Buffer.from(bytes),
      path = join(f.outputs, mode + '.mnrbackup');
    if (mode === 'oversized') {
      tampered.writeUInt32LE(9 * 1024 ** 2, central + 20);
      tampered.writeUInt32LE(9 * 1024 ** 2, central + 24);
    } else tampered.writeUInt32LE((tampered.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
    fs.writeFileSync(path, tampered);
    await assert.rejects(
      () => readArchive(path),
      (e) => e.code === (mode === 'oversized' ? 'LIMIT' : 'INVALID_BACKUP'),
    );
    assert.equal(snapshot(f.db), before);
  }
  for (const [name, bad] of [
    ['truncated', bytes.subarray(0, bytes.length - 20)],
    ['false-extension', Buffer.from('not a ZIP')],
  ]) {
    const file = join(f.outputs, name + '.mnrbackup');
    fs.writeFileSync(file, bad);
    const target = await newOwnedSet(f.root, 'work');
    await assert.rejects(() => inspectArchive(file, target.path));
    assert.equal(snapshot(f.db), before);
  }
  assert.deepEqual(
    await hashFile(
      join(
        f.images,
        'objects',
        f.db.prepare('SELECT foto_id FROM produto_fotos').get().foto_id + '.image',
      ),
    ),
    photoHash,
  );
});

test('5.1 future/corrupt/foreign-key/SQL-tampered SQLite is rejected even with matching archive hashes', async (t) => {
  const f = await backupFixture(t),
    work = await newOwnedSet(f.root, 'work');
  await captureSet(f.db.name, f.images, work.path, 'test');
  const { encodeManifest } = require('../dist/electron/services/backup/format'),
    original = (await validateSet(work.path)).manifest,
    Database = require('better-sqlite3');
  const before = snapshot(f.db);
  for (const kind of ['future', 'corrupt', 'foreign-key', 'trigger']) {
    const dbFile = join(f.outputs, kind + '.db');
    fs.copyFileSync(join(work.path, 'data/mnr-perfumes.db'), dbFile);
    if (kind === 'corrupt') fs.writeFileSync(dbFile, Buffer.from('not SQLite'));
    else {
      const db = new Database(dbFile);
      try {
        if (kind === 'future') db.pragma('user_version=6');
        if (kind === 'foreign-key') {
          db.pragma('foreign_keys=OFF');
          db.prepare('UPDATE produtos SET marca_id=999999 WHERE id=?').run(f.cycle.productId);
        }
        if (kind === 'trigger')
          db.exec('CREATE TRIGGER injected AFTER INSERT ON produtos BEGIN SELECT abs(1); END');
      } finally {
        db.close();
      }
    }
    const manifest = structuredClone(original);
    manifest.files[0] = { path: 'data/mnr-perfumes.db', ...(await hashFile(dbFile)) };
    const files = [
      { name: 'manifest.json', bytes: encodeManifest(manifest) },
      ...manifest.files.map((p) => ({
        name: p.path,
        bytes: fs.readFileSync(p.path.startsWith('data/') ? dbFile : join(work.path, p.path)),
      })),
    ];
    const archive = join(f.outputs, kind + '.mnrbackup');
    await craftedZip(archive, files);
    const target = await newOwnedSet(f.root, 'sets');
    await assert.rejects(() => inspectArchive(archive, target.path));
    assert.equal(snapshot(f.db), before);
  }
});

test('5.1 native publication preserves raced destinations, special names, and exposes no partial backup after faults', async (t) => {
  const f = await backupFixture(t, false),
    { moveDurable } = require('../dist/electron/services/backup/io');
  const source = join(f.outputs, 'source'),
    destination = join(f.outputs, "Água & ' $(nao-executar).mnrbackup");
  fs.writeFileSync(source, 'new');
  fs.writeFileSync(destination, 'old');
  await assert.rejects(
    () => moveDurable(source, destination),
    (e) => e.code === 'EEXIST',
  );
  assert.equal(fs.readFileSync(destination, 'utf8'), 'old');
  assert.equal(fs.readFileSync(source, 'utf8'), 'new');
  const controller = (path) =>
    new BackupController({
      root: f.root,
      db: f.db,
      photos: f.photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => path,
      chooseRestore: async () => undefined,
      restart: () => {},
      openProtections: async () => {},
    });
  const before = snapshot(f.db);
  assert.equal(await controller(undefined).create(), null);
  await assert.rejects(
    () => controller(destination).create(),
    (e) => e.code === 'EEXIST',
  );
  await assert.rejects(
    () => controller(join(f.root, 'forbidden.mnrbackup')).create(),
    (e) => e.code === 'UNSAFE_STORAGE',
  );
  const io = require('../dist/electron/services/backup/io');
  for (const code of ['ENOSPC', 'EACCES', 'ENOENT', 'PUBLISH_FAILED']) {
    const mock = t.mock.method(io, 'moveDurable', async () => {
      throw Object.assign(Error('private path and SQL'), { code });
    });
    const path = join(f.outputs, code + '.mnrbackup');
    await assert.rejects(
      () => controller(path).create(),
      (e) => e.code === code,
    );
    mock.mock.restore();
    assert(!fs.existsSync(path));
    assert.equal(snapshot(f.db), before);
  }
  const created = await controller(join(f.outputs, 'valid-special + @.mnrbackup')).create();
  assert(created.bytes > 0);
  assert.equal(snapshot(f.db), before);
});

test('5.1 pending mutations/photo replacement drain before capture; later writes do not enter the package', async (t) => {
  const f = await backupFixture(t),
    { DataGate } = require('../dist/electron/services/backup/gate'),
    gate = new DataGate();
  const token = await f.photos.prepare(f.png, 7);
  let release;
  const barrier = new Promise((r) => (release = r)),
    held = f.photos.withLock(() => barrier);
  const mutation = gate.run(() =>
    f.photos.save(f.command({ produtoId: f.cycle.productId, token: token.token }), 7),
  );
  const jobs = require('../dist/electron/services/backup/jobs'),
    real = jobs.backupJob;
  let allowPack, packStarted;
  const begun = new Promise((r) => (packStarted = r)),
    holdPack = new Promise((r) => (allowPack = r));
  t.mock.method(jobs, 'backupJob', async (task) => {
    if (task.task === 'package') {
      packStarted();
      await holdPack;
    }
    return real(task);
  });
  const path = join(f.outputs, 'coordinated.mnrbackup'),
    controller = new BackupController(
      {
        root: f.root,
        db: f.db,
        photos: f.photos,
        version: 'test',
        protectedRoots: [f.root],
        chooseBackup: async () => path,
        chooseRestore: async () => undefined,
        restart: () => {},
        openProtections: async () => {},
      },
      gate,
    );
  const pending = controller.create();
  for (let n = 0; n < 200 && !gate.blocked; n++) await new Promise((r) => setTimeout(r, 10));
  assert(gate.blocked);
  const count = f.db.prepare('SELECT count(*) n FROM operacoes').get().n;
  assert.equal(
    gate.run(() => {
      throw Error('should not run');
    }).error.code,
    'BUSY',
  );
  assert.equal(f.db.prepare('SELECT count(*) n FROM operacoes').get().n, count);
  release();
  await held;
  await mutation;
  await begun;
  assert.equal(gate.blocked, false);
  const captured = snapshot(f.db);
  gate.run(() =>
    f.cycle.stock.registrarEntrada(
      f.cycle.stockCommand({ produtoId: f.cycle.manual.id, quantidade: 2, custoTotalCentavos: 1 }),
    ),
  );
  allowPack();
  await pending;
  const restored = await newOwnedSet(f.root, 'sets');
  await inspectArchive(path, restored.path);
  const Database = require('better-sqlite3'),
    copy = new Database(join(restored.path, 'data/mnr-perfumes.db'), { readonly: true });
  assert.equal(snapshot(copy), captured);
  assert.equal(copy.prepare('SELECT foto_id FROM produto_fotos').get().foto_id, token.token);
  copy.close();
  assert.notEqual(snapshot(f.db), captured);
});

test('5.1 traversal, absolute names, alternate streams and case conflicts are rejected before extraction', async (t) => {
  const f = await backupFixture(t, false),
    before = snapshot(f.db);
  for (const bad of [
    '../escape.db',
    '../../escape.db',
    'C:/escape.db',
    '/escape.db',
    'data\\escape.db',
    'data/file:ADS',
    'DATA/mnr-perfumes.db',
  ]) {
    const name = 'a'.repeat(Buffer.byteLength(bad)),
      file = join(f.outputs, f.randomUUID() + '.mnrbackup');
    await craftedZip(file, [{ name, bytes: Buffer.from('untrusted') }]);
    const bytes = fs.readFileSync(file),
      a = Buffer.from(name),
      b = Buffer.from(bad);
    let n = 0;
    for (let at = bytes.indexOf(a); at >= 0; at = bytes.indexOf(a, at + a.length)) {
      b.copy(bytes, at);
      n++;
    }
    assert(n >= 2);
    fs.writeFileSync(file, bytes);
    const target = await newOwnedSet(f.root, 'sets');
    await assert.rejects(() => inspectArchive(file, target.path));
    assert.deepEqual(fs.readdirSync(target.path), ['owner.json']);
    assert.equal(snapshot(f.db), before);
  }
});

test('5.1 absent photo prevents backup; stale tokens/extra fields and selection do not alter current data', async (t) => {
  const f = await backupFixture(t),
    file = join(f.outputs, 'photo.mnrbackup'),
    controller = new BackupController({
      root: f.root,
      db: f.db,
      photos: f.photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => file,
      chooseRestore: async () => undefined,
      restart: () => {},
      openProtections: async () => {},
    }),
    before = snapshot(f.db);
  assert.equal(await controller.inspect(), null);
  for (const input of [
    undefined,
    { token: [f.randomUUID()], confirmacao: 'RESTAURAR' },
    { token: f.randomUUID(), confirmacao: 'RESTAURAR', path: 'C:/x' },
    { token: f.randomUUID(), confirmacao: 'RESTAURAR' },
    { token: f.randomUUID(), confirmacao: 'nao' },
  ])
    await assert.rejects(() => controller.restore(input));
  const row = f.db.prepare('SELECT foto_id FROM produto_fotos').get();
  fs.unlinkSync(join(f.images, 'objects', row.foto_id + '.image'));
  await assert.rejects(
    () => controller.create(),
    (e) => e.code === 'MISSING_PHOTO',
  );
  assert(!fs.existsSync(file));
  assert.equal(snapshot(f.db), before);
  assert.equal((await controller.status()).ocupado, false);
  assert.equal(controller.gate.blocked, false);
});

test('5.1 selected archive can change afterwards; frozen review restores only its validated staging', async (t) => {
  const f = await backupFixture(t),
    file = join(f.outputs, 'selected.mnrbackup'),
    controller = new BackupController({
      root: f.root,
      db: f.db,
      photos: f.photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => file,
      chooseRestore: async () => file,
      restart: () => {},
      openProtections: async () => {},
    });
  await controller.create();
  const before = snapshot(f.db),
    review = await controller.inspect();
  fs.writeFileSync(file, Buffer.from('replaced after inspection'));
  f.cycle.stock.registrarEntrada(
    f.cycle.stockCommand({ produtoId: f.cycle.manual.id, quantidade: 1, custoTotalCentavos: 1 }),
  );
  await controller.restore({ token: review.token, confirmacao: 'RESTAURAR' });
  f.db.close();
  const active = await recoverAndOpen(f.root, 'test');
  assert.equal(snapshot(active.db), before);
  active.db.close();
});

test('5.1 process termination at pointer/open/commit boundaries recovers idempotently with no mixed generation', async (t) => {
  const { spawnSync } = require('node:child_process'),
    { createFotoService } = require('../dist/electron/services/fotos');
  for (const phase of ['before-pointer', 'after-pointer', 'after-open', 'after-commit']) {
    const f = await backupFixture(t),
      archive = join(f.outputs, 'baseline.mnrbackup'),
      controller = new BackupController({
        root: f.root,
        db: f.db,
        photos: f.photos,
        version: 'test',
        protectedRoots: [f.root],
        chooseBackup: async () => archive,
        chooseRestore: async () => archive,
        restart: () => {},
        openProtections: async () => {},
      });
    await controller.create();
    const original = snapshot(f.db);
    await f.photos.remove(f.command({ produtoId: f.cycle.productId }), 7);
    f.cycle.stock.registrarEntrada(
      f.cycle.stockCommand({ produtoId: f.cycle.manual.id, quantidade: 4, custoTotalCentavos: 5 }),
    );
    const changed = snapshot(f.db);
    const r = await controller.inspect();
    await controller.restore({ token: r.token, confirmacao: 'RESTAURAR' });
    f.db.close();
    const child = spawnSync(
      process.execPath,
      ['tests/helpers/backup-recovery-child.cjs', f.root, phase],
      { encoding: 'utf8', timeout: 60000, windowsHide: true },
    );
    assert.equal(child.status, 42, phase + ' ' + child.stderr);
    const active = await recoverAndOpen(f.root, 'test'),
      expected = phase === 'after-open' ? changed : original;
    assert.equal(snapshot(active.db), expected, phase);
    const photos = createFotoService(active.db, active.images, 'test', f.normalize),
      image = photos.obtain({ produtoId: f.cycle.productId, variante: 'imagem' });
    assert.equal(image === null, phase === 'after-open');
    if (image) assert.deepEqual(Buffer.from(image.bytes), f.png);
    assert.equal(active.db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(active.db.pragma('foreign_key_check'), []);
    active.db.close();
    const second = await recoverAndOpen(f.root, 'test');
    assert.equal(snapshot(second.db), expected);
    second.db.close();
    assert(fs.existsSync(join(recoveryPaths(f.root).protection, r.token + '.mnrbackup')));
  }
});

test('5.1 tampered prepared generation rolls back to the validated previous set and preserves its protection', async (t) => {
  const f = await backupFixture(t),
    archive = join(f.outputs, 'baseline.mnrbackup'),
    controller = new BackupController({
      root: f.root,
      db: f.db,
      photos: f.photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => archive,
      chooseRestore: async () => archive,
      restart: () => {},
      openProtections: async () => {},
    });
  await controller.create();
  f.cycle.stock.registrarEntrada(
    f.cycle.stockCommand({ produtoId: f.cycle.manual.id, quantidade: 2, custoTotalCentavos: 3 }),
  );
  const changed = snapshot(f.db),
    r = await controller.inspect();
  await controller.restore({ token: r.token, confirmacao: 'RESTAURAR' });
  f.db.close();
  fs.writeFileSync(
    join(recoveryPaths(f.root).sets, r.token, 'data/mnr-perfumes.db'),
    Buffer.from('failed activation'),
  );
  const recovered = await recoverAndOpen(f.root, 'test');
  assert.equal(snapshot(recovered.db), changed);
  assert.equal(await selection(f.root), null);
  recovered.db.close();
  assert(fs.existsSync(join(recoveryPaths(f.root).protection, r.token + '.mnrbackup')));
});

test('5.1 restored dataset accepts new official writes and subsequent backup/restore, with bounded retention', async (t) => {
  const f = await backupFixture(t, false),
    archive = join(f.outputs, 'empty.mnrbackup');
  let db = f.db,
    photos = f.photos;
  for (let n = 0; n < 5; n++) {
    const controller = new BackupController({
      root: f.root,
      db,
      photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => archive,
      chooseRestore: async () => archive,
      restart: () => {},
      openProtections: async () => {},
    });
    if (!n) await controller.create();
    const r = await controller.inspect();
    await controller.restore({ token: r.token, confirmacao: 'RESTAURAR' });
    db.close();
    const active = await recoverAndOpen(f.root, 'test');
    db = active.db;
    photos = require('../dist/electron/services/fotos').createFotoService(
      db,
      active.images,
      'test',
      f.normalize,
    );
    const cat = require('../dist/electron/services/catalogos').createCatalogService(db, 'test');
    cat.savePerson('CLIENTE', f.command({ nome: 'Depois da restauração ' + n }));
    assert.equal(db.prepare('SELECT count(*) n FROM clientes').get().n, 1);
  }
  assert.equal(
    fs.readdirSync(recoveryPaths(f.root).protection).filter((n) => n.endsWith('.mnrbackup')).length,
    3,
  );
  assert(fs.readdirSync(recoveryPaths(f.root).sets).length <= 4);
  db.close();
});

test('5.1 six protected backup channels validate sender/frame/origin/arity without invoking operations', async () => {
  const vm = require('node:vm'),
    { resolve } = require('node:path'),
    handlers = new Map();
  let called = 0;
  const sandbox = {
    exports: {},
    require: (name) =>
      name === 'electron'
        ? { ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) } }
        : require(resolve('dist/electron/ipc', name)),
  };
  vm.runInNewContext(fs.readFileSync('dist/electron/ipc/backup.js', 'utf8'), sandbox);
  const service = Object.fromEntries(
    ['status', 'create', 'inspect', 'discard', 'restore', 'openProtections'].map((k) => [
      k,
      () => {
        called++;
        return null;
      },
    ]),
  );
  const frame = { url: 'mnr://app/index.html#/configuracoes/backup' },
    window = { webContents: { mainFrame: frame } };
  sandbox.exports.registerBackup(window, 'mnr://app/index.html', service);
  assert.equal(handlers.size, 6);
  for (const [channel, handler] of handlers) {
    for (const event of [
      { sender: {}, senderFrame: frame },
      { sender: window.webContents, senderFrame: null },
      { sender: window.webContents, senderFrame: { url: frame.url } },
      { sender: window.webContents, senderFrame: { url: 'https://bad.invalid' } },
    ])
      await assert.rejects(() => handler(event), /não autorizada/);
    const event = { sender: window.webContents, senderFrame: frame };
    for (const args of [
      channel.endsWith(':restaurar') || channel.endsWith(':descartar') ? [] : [{}],
      [{}, {}],
    ]) {
      const r = await handler(event, ...args);
      assert.equal(r.ok, false);
      assert(!/SELECT|C:\\|stack|sqlite/i.test(r.error.message));
    }
  }
  assert.equal(called, 0);
});

test('5.1 real independent WAL writer produces a transactionally complete snapshot prefix', async (t) => {
  const f = await backupFixture(t),
    { Worker } = require('node:worker_threads'),
    { resolve } = require('node:path'),
    { backupJob } = require('../dist/electron/services/backup/jobs'),
    stop = new SharedArrayBuffer(4),
    writer = new Worker(resolve('tests/helpers/backup-writer.cjs'), {
      workerData: { directory: f.data, stop },
    });
  t.after(() => writer.terminate());
  await new Promise((r, j) => {
    writer.once('message', r);
    writer.once('error', j);
  });
  const completed = new Promise((r, j) => {
      writer.once('message', r);
      writer.once('error', j);
    }),
    target = await newOwnedSet(f.root, 'work');
  try {
    await backupJob({
      task: 'capture',
      database: f.db.name,
      images: f.images,
      target: target.path,
      version: 'test',
    });
  } finally {
    Atomics.store(new Int32Array(stop), 0, 1);
  }
  const final = await completed,
    Database = require('better-sqlite3'),
    copy = new Database(join(target.path, 'data/mnr-perfumes.db'), { readonly: true });
  try {
    const clients = copy
      .prepare("SELECT id,nome FROM clientes WHERE nome LIKE 'BK-CONCURRENT-%' ORDER BY id")
      .all();
    assert(
      clients.length > 0 && clients.length < final.count,
      `snapshot=${clients.length},writer=${final.count}`,
    );
    assert.deepEqual(
      clients.map((c) => c.nome),
      clients.map((_, i) => `BK-CONCURRENT-${String(i).padStart(5, '0')}`),
    );
    assert.equal(
      copy
        .prepare(
          "SELECT count(*) n FROM eventos_auditoria a JOIN clientes c ON c.id=a.cliente_id JOIN operacoes o ON o.id=a.operacao_id WHERE c.nome LIKE 'BK-CONCURRENT-%' AND o.resultado_json<>'null'",
        )
        .get().n,
      clients.length,
    );
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(copy.pragma('foreign_key_check'), []);
  } finally {
    copy.close();
  }
});

test('5.1 cleanup preserves unknown or replaced files even with a valid payload filename', async (t) => {
  const f = await backupFixture(t),
    { removeOwnedSet } = require('../dist/electron/services/backup/control'),
    { randomUUID } = require('node:crypto');
  for (const mode of ['unknown', 'replaced', 'modified']) {
    const set = await newOwnedSet(f.root, 'work');
    await captureSet(f.db.name, f.images, set.path, 'test');
    const original = fs
        .readdirSync(join(set.path, 'images/objects'))
        .find((n) => n.endsWith('.image')),
      path = join(
        set.path,
        'images/objects',
        mode === 'unknown' ? randomUUID() + '.image' : original,
      );
    if (mode === 'replaced') fs.unlinkSync(path);
    fs.writeFileSync(path, Buffer.from('Must be preserved: ' + mode));
    const before = fs.readdirSync(set.path);
    await assert.rejects(() => removeOwnedSet(f.root, 'work', set.id));
    assert.deepEqual(fs.readdirSync(set.path), before);
    assert.equal(fs.readFileSync(path, 'utf8'), 'Must be preserved: ' + mode);
    assert(fs.existsSync(join(set.path, 'data/mnr-perfumes.db')));
  }
  const crypto = require('node:crypto'),
    fixed = randomUUID(),
    collision = join(f.outputs, `.mnr-control-${fixed}.partial`),
    { durableJson } = require('../dist/electron/services/backup/io');
  fs.writeFileSync(collision, 'Unknown existing control file');
  const mock = t.mock.method(crypto, 'randomUUID', () => fixed);
  await assert.rejects(
    () => durableJson(join(f.outputs, 'control.json'), { format: 1 }),
    (e) => e.code === 'EEXIST',
  );
  mock.mock.restore();
  assert.equal(fs.readFileSync(collision, 'utf8'), 'Unknown existing control file');
});

test('5.1 capture/media/package failures preserve current data and allow a new attempt before arming', async (t) => {
  const f = await backupFixture(t),
    archive = join(f.outputs, 'failure-cycle.mnrbackup'),
    controller = new BackupController({
      root: f.root,
      db: f.db,
      photos: f.photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => archive,
      chooseRestore: async () => archive,
      restart: () => assert.fail('No restart before durable intent'),
      openProtections: async () => {},
    });
  const before = snapshot(f.db),
    jobs = require('../dist/electron/services/backup/jobs'),
    original = jobs.backupJob;
  for (const phase of ['capture', 'package']) {
    const mock = t.mock.method(jobs, 'backupJob', async (task) => {
      if (task.task === phase) throw Object.assign(Error('private details'), { code: 'ENOSPC' });
      return original(task);
    });
    await assert.rejects(
      () => controller.create(),
      (e) => e.code === 'ENOSPC',
    );
    mock.mock.restore();
    assert.equal(snapshot(f.db), before);
    assert(!fs.existsSync(archive));
    assert.equal((await controller.status()).ocupado, false);
  }
  for (const code of ['ENOSPC', 'EIO', 'EACCES']) {
    const originalRead = fs.createReadStream;
    const mock = t.mock.method(fs, 'createReadStream', (path, ...args) => {
      if (String(path).endsWith('.image'))
        throw Object.assign(Error('test media failure'), { code });
      return originalRead(path, ...args);
    });
    const target = await newOwnedSet(f.root, 'work');
    await assert.rejects(
      () => captureSet(f.db.name, f.images, target.path, 'test'),
      (e) => e.code === code,
    );
    mock.mock.restore();
    assert.equal(snapshot(f.db), before);
  }
  await controller.create();
  for (const code of ['ENOSPC', 'EACCES', 'EIO']) {
    const promises = require('node:fs/promises'),
      originalOpen = promises.open,
      target = await newOwnedSet(f.root, 'sets'),
      mock = t.mock.method(promises, 'open', async (path, flags, ...args) => {
        if (String(path).endsWith('.image') && flags === 'wx')
          throw Object.assign(Error('test extraction failure'), { code });
        return originalOpen(path, flags, ...args);
      });
    await assert.rejects(
      () => inspectArchive(archive, target.path),
      (e) => e.code === code,
    );
    mock.mock.restore();
    assert.equal(snapshot(f.db), before);
  }
  const reviewed = await controller.inspect(),
    mock = t.mock.method(jobs, 'backupJob', async (task) => {
      if (task.task === 'capture') throw Object.assign(Error('cannot protect'), { code: 'ENOSPC' });
      return original(task);
    });
  await assert.rejects(
    () => controller.restore({ token: reviewed.token, confirmacao: 'RESTAURAR' }),
    (e) => e.code === 'ENOSPC',
  );
  mock.mock.restore();
  assert.equal(snapshot(f.db), before);
  assert.equal(await selection(f.root), null);
  assert(!fs.existsSync(recoveryPaths(f.root).pending));
  assert.equal(controller.gate.blocked, false);
  f.cycle.cat.savePerson(
    'CLIENTE',
    f.command({ nome: 'Normal operation after failed protection' }),
  );
  assert.notEqual(snapshot(f.db), before);
  const preserved = snapshot(f.db),
    io = require('../dist/electron/services/backup/io'),
    realJson = io.durableJson;
  let restarts = 0;
  const armed = new BackupController({
      root: f.root,
      db: f.db,
      photos: f.photos,
      version: 'test',
      protectedRoots: [f.root],
      chooseBackup: async () => archive,
      chooseRestore: async () => archive,
      restart: () => restarts++,
      openProtections: async () => {},
    }),
    secondReview = await armed.inspect(),
    journalMock = t.mock.method(io, 'durableJson', async (path, ...args) => {
      if (path === recoveryPaths(f.root).pending)
        throw Object.assign(Error('failed durable pending'), { code: 'EIO' });
      return realJson(path, ...args);
    });
  await armed.restore({ token: secondReview.token, confirmacao: 'RESTAURAR' });
  journalMock.mock.restore();
  assert.equal(restarts, 1);
  assert.equal(armed.gate.blocked, true);
  assert.equal(snapshot(f.db), preserved);
  f.db.close();
  const reopened = await recoverAndOpen(f.root, 'test');
  try {
    assert.equal(snapshot(reopened.db), preserved);
    assert.equal(reopened.recovery, true);
    assert.match(reopened.warning, /tentativa/i);
  } finally {
    reopened.db.close();
  }
  await io.durableJson(recoveryPaths(f.root).active, { format: 1, id: secondReview.token }, true);
  await assert.rejects(
    () => recoverAndOpen(f.root, 'test'),
    (e) => e.code === 'RECOVERY_REQUIRED',
  );
});
