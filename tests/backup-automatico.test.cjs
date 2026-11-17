const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const {
  initialUsage,
  recordUsage,
  satisfyUsage,
  backupDue,
  usageDaysRemaining,
} = require('../dist/shared/backup-policy');
const {
  RecurringBackupService,
  localBackupDay,
} = require('../dist/electron/services/backup/recurring');
const { BackupController } = require('../dist/electron/services/backup/controller');
const { backupFixture } = require('./helpers/backup-fixture.cjs');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { readArchive } = require('../dist/electron/services/backup/format');
const { hashFile } = require('../dist/electron/services/backup/io');

async function fixture(t, full = false) {
  const f = await backupFixture(t, full);
  let day = '2026-11-02T12:00:00',
    folder = f.outputs;
  const controller = new BackupController({
    root: f.root,
    db: f.db,
    photos: f.photos,
    version: 'test',
    protectedRoots: [f.root],
    chooseBackup: async () => path.join(f.outputs, 'manual-' + f.randomUUID() + '.mnrbackup'),
    chooseRestore: async () => undefined,
    restart: () => {},
    openProtections: async () => {},
  });
  const service = new RecurringBackupService({
    root: f.root,
    backup: controller,
    chooseFolder: async () => folder,
    now: () => new Date(day),
  });
  await service.start();
  t.after(() => service.stop());
  return {
    ...f,
    controller,
    service,
    day: (value) => {
      day = value + 'T12:00:00';
    },
    folder: (value) => {
      folder = value;
    },
  };
}
const wait = async (fn) => {
  for (let i = 0; i < 1200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out waiting for recurring backup');
};

test('Usage engine: distinct days, skipped dates, repeated openings, midnight, manual reset and clock regression', () => {
  let s = initialUsage();
  assert.equal(usageDaysRemaining(s), 3);
  s = recordUsage(s, '2026-11-02');
  assert.equal(usageDaysRemaining(s), 2);
  assert.equal(s.count, 1);
  for (let i = 0; i < 4; i++) s = recordUsage(s, '2026-11-02');
  assert.equal(s.count, 1);
  assert(!backupDue(s));
  s = recordUsage(s, '2026-11-04');
  assert.equal(usageDaysRemaining(s), 1);
  assert.equal(s.count, 2);
  assert(!backupDue(s));
  s = recordUsage(s, '2026-11-05');
  assert.equal(usageDaysRemaining(s), 0);
  assert.equal(s.count, 3);
  assert(backupDue(s));
  s = recordUsage(s, '2026-11-06');
  assert.equal(s.count, 4);
  s = satisfyUsage('2026-11-06');
  s = recordUsage(s, '2026-11-06');
  assert.equal(s.count, 0);
  s = recordUsage(s, '2026-11-07');
  assert.equal(s.count, 1);
  s = recordUsage(s, '2026-11-06');
  assert(s.clockWarning && backupDue(s));
  assert.equal(s.count, 1);
  s = satisfyUsage('2026-11-06');
  assert(!backupDue(s));
  s = recordUsage(s, '2026-11-07');
  s = recordUsage(s, '2026-11-08');
  assert.equal(s.count, 2);
  assert(
    backupDue(recordUsage(s, '2026-11-06')),
    'Returning to an old satisfied date cannot bypass a later cycle',
  );
  assert.equal(localBackupDay(new Date(2026, 10, 2, 23, 59)), '2026-11-02');
  assert.equal(localBackupDay(new Date(2026, 10, 3, 0, 1)), '2026-11-03');
  const { spawnSync } = require('node:child_process');
  const localDayInZone = (TZ) => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "const {localBackupDay}=require('./dist/electron/services/backup/recurring');process.stdout.write(localBackupDay(new Date('2026-11-03T01:00:00Z')))",
      ],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, TZ },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  };
  const brazil = localDayInZone('America/Sao_Paulo'),
    utc = localDayInZone('UTC');
  assert.equal(brazil, '2026-11-02');
  assert.equal(utc, '2026-11-03');
  const changedZone = recordUsage(recordUsage(initialUsage(), brazil), utc);
  assert.equal(changedZone.count, 2);
  assert(
    backupDue(recordUsage(changedZone, brazil)),
    'Backward zone change conservatively requires a copy',
  );
});

test('Recurring: persisted days, no writes on repeated usage/status, native cancellation and strict configuration', async (t) => {
  const f = await fixture(t),
    s = f.service;
  await s.use();
  const file = path.join(f.root, 'backup-policy/state.json'),
    before = fs.readFileSync(file);
  for (let i = 0; i < 4; i++) {
    await s.use();
    s.status();
  }
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(s.status().dias, 1);
  f.day('2026-11-04');
  await s.use();
  assert.equal(s.status().dias, 2);
  f.folder(undefined);
  assert.equal(await s.selectFolder(), null);
  assert.equal(s.status().destino, undefined);
  await assert.rejects(s.configure({ habilitado: false, retencao: 7, path: 'C:/arbitrary' }));
  await assert.rejects(s.configure({ habilitado: false, retencao: 0 }));
  f.day('2026-11-05');
  await s.use();
  assert(s.status().devido);
  assert.equal(s.status().dias, 3);
  const r = new RecurringBackupService({
    root: f.root,
    backup: f.controller,
    chooseFolder: async () => undefined,
    now: () => new Date('2026-11-05T12:00:00'),
  });
  t.after(() => r.stop());
  await r.start();
  await r.use();
  assert.equal(r.status().dias, 3);
  assert(r.status().devido);
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('Recurring: automatic day three uses official full SQLite/photo capture and manual copy satisfies day two', async (t) => {
  const f = await fixture(t, true),
    s = f.service,
    before = snapshot(f.db);
  await s.selectFolder();
  await s.use();
  f.day('2026-11-04');
  await s.use();
  assert.equal(s.status().dias, 2);
  const manual = await f.controller.create();
  assert(manual);
  assert.equal(s.status().dias, 0);
  await s.use();
  assert.equal(s.status().dias, 0);
  for (const d of ['2026-11-05', '2026-11-07', '2026-11-09']) {
    f.day(d);
    await s.use();
  }
  await wait(() => s.status().ultimoBackup?.tipo === 'automatico' && !s.occupied);
  assert.equal(s.status().dias, 0);
  assert(!s.status().devido);
  const generated = fs.readdirSync(f.outputs).filter((n) => n.startsWith('MNR-Gestao-Auto-'));
  assert.equal(generated.length, 1);
  const m = await readArchive(path.join(f.outputs, generated[0]));
  assert.equal(m.schema, 6);
  assert.equal(snapshot(f.db), before, 'Policy and export cannot write commercial data');
  assert.equal(s.status().historico.filter((x) => x.evento === 'concluido').length, 2);
});

test('Recurring: unavailable media, deferral, bounded retry, changed destination and manual recovery preserve due state', async (t) => {
  const f = await fixture(t),
    s = f.service;
  await s.selectFolder();
  fs.renameSync(f.outputs, f.outputs + '-offline');
  try {
    for (const d of ['2026-11-02', '2026-11-04', '2026-11-05']) {
      f.day(d);
      await s.use();
    }
    await wait(() => s.status().estado === 'erro');
    assert(s.status().devido);
    assert.equal(s.status().dias, 3);
    const errors = s.status().historico.filter((h) => h.evento === 'falha').length;
    for (let i = 0; i < 4; i++) await s.use();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(s.status().historico.filter((h) => h.evento === 'falha').length, errors);
    await s.defer({ motivo: 'MIDIA_INDISPONIVEL' });
    assert(s.status().devido);
    assert(s.status().adiadoEm);
  } finally {
    fs.renameSync(f.outputs + '-offline', f.outputs);
  }
  fs.renameSync(f.outputs, f.outputs + '-old');
  fs.mkdirSync(f.outputs);
  await assert.rejects(s.execute(), (e) => e.code === 'DESTINATION_CHANGED');
  assert(s.status().devido);
  await s.selectFolder();
  await s.execute();
  assert(!s.status().devido);
  assert.equal(s.status().dias, 0);
});

test('Recurring: manual/automatic mutual exclusion and directory/protected-root rejection', async (t) => {
  const f = await fixture(t),
    s = f.service;
  f.folder(f.root);
  await assert.rejects(s.selectFolder(), (e) => e.code === 'UNSAFE_STORAGE');
  f.folder(f.outputs);
  await s.selectFolder();
  await s.configure({ habilitado: false, retencao: 3 });
  const first = s.execute();
  await assert.rejects(s.execute(), (e) => e.code === 'BUSY');
  await first;
  const manual = f.controller.create();
  await assert.rejects(s.execute(), (e) => e.code === 'BUSY');
  await manual;
  assert.equal(s.status().dias, 0);
  assert.equal(s.status().ultimoBackup.tipo, 'manual');
  const inspection = f.controller.inspect();
  await assert.rejects(s.execute(), (e) => e.code === 'BUSY');
  await inspection;
  const link = path.join(f.root, 'linked-destination');
  fs.symlinkSync(f.outputs, link, 'junction');
  f.folder(link);
  await assert.rejects(s.selectFolder(), (e) => e.code === 'UNSAFE_STORAGE');
});

test('Recurring retention: only proven own automatic files, manual/unknown/replaced files preserved', async (t) => {
  const f = await fixture(t),
    s = f.service;
  await s.selectFolder();
  await s.configure({ habilitado: false, retencao: 3 });
  const manual = await f.controller.create(),
    manualPath = path.join(f.outputs, manual.nome),
    manualHash = await hashFile(manualPath);
  fs.writeFileSync(path.join(f.outputs, 'unknown.mnrbackup'), 'unknown');
  await s.configure({ habilitado: true, retencao: 3 });
  let offset = 1;
  const generated = [];
  const automatic = async () => {
    const old = s.status().ultimoBackup?.nome;
    for (let i = 0; i < 3; i++) {
      const d = new Date(2026, 10, 2 + offset++);
      f.day(localBackupDay(d));
      await s.use();
    }
    await wait(() => s.status().ultimoBackup?.nome !== old && !s.occupied);
    assert.equal(s.status().ultimoBackup.tipo, 'automatico');
    generated.push(s.status().ultimoBackup.nome);
  };
  await automatic();
  const first = fs.readdirSync(f.outputs).find((n) => n.startsWith('MNR-Gestao-Auto-'));
  const replaced = path.join(f.outputs, first),
    copy = fs.readFileSync(replaced);
  fs.renameSync(replaced, replaced + '.original');
  fs.writeFileSync(replaced, copy);
  for (let i = 0; i < 4; i++) await automatic();
  assert(
    !fs.existsSync(path.join(f.outputs, generated[1])),
    'Verified obsolete own copy must rotate',
  );
  for (const name of generated.slice(-3)) assert(fs.existsSync(path.join(f.outputs, name)));
  assert(fs.existsSync(replaced), 'Same bytes with changed file identity must be preserved');
  assert(s.status().aviso);
  assert.equal((await hashFile(manualPath)).sha256, manualHash.sha256);
  assert.equal(fs.readFileSync(path.join(f.outputs, 'unknown.mnrbackup'), 'utf8'), 'unknown');
  const last = s.status().ultimoBackup.nome;
  assert(fs.existsSync(path.join(f.outputs, last)));
  assert(!s.status().devido);
  s.retain = async () => {
    throw Error('External cleanup failure after durable credit');
  };
  await automatic();
  assert(!s.status().devido, 'Cleanup failure cannot invalidate an already committed valid copy');
  assert(s.status().aviso);
});

test('Recurring: durable unacknowledged publication is validated and credited once after reopening', async (t) => {
  const f = await fixture(t, true),
    s = f.service;
  await s.selectFolder();
  await s.configure({ habilitado: false, retencao: 7 });
  const real = s.completed.bind(s);
  s.completed = async () => {
    throw Error('External lost completion callback');
  };
  await assert.rejects(s.execute());
  s.stop();
  s.completed = real;
  const r = new RecurringBackupService({
    root: f.root,
    backup: f.controller,
    chooseFolder: async () => undefined,
    now: () => new Date('2026-11-02T13:00:00'),
  });
  t.after(() => r.stop());
  await r.start();
  assert(!r.status().devido);
  assert.equal(r.status().ultimoBackup.tipo, 'manual');
  assert.equal(r.status().historico.filter((h) => h.evento === 'concluido').length, 1);
  const r2 = new RecurringBackupService({
    root: f.root,
    backup: f.controller,
    chooseFolder: async () => undefined,
  });
  t.after(() => r2.stop());
  await r2.start();
  assert.equal(r2.status().historico.filter((h) => h.evento === 'concluido').length, 1);
});

test('Recurring: restoration marker never rolls back local destination/days; corrupt policy fails closed without blocking manual backup', async (t) => {
  const f = await fixture(t),
    s = f.service;
  await s.selectFolder();
  await f.controller.create();
  s.stop();
  const result = {
    situacao: 'restaurado',
    criadoEm: '2026-11-02T12:00:00Z',
    protecao: f.randomUUID() + '.mnrbackup',
  };
  const r = new RecurringBackupService({
    root: f.root,
    backup: f.controller,
    chooseFolder: async () => undefined,
  });
  t.after(() => r.stop());
  await r.start(result);
  assert(r.status().devido);
  assert.equal(r.status().destino, f.outputs);
  const file = path.join(f.root, 'backup-policy/state.json');
  fs.writeFileSync(file, 'corrupt');
  const bad = new RecurringBackupService({
    root: f.root,
    backup: f.controller,
    chooseFolder: async () => undefined,
  });
  t.after(() => bad.stop());
  await bad.start();
  assert(bad.status().devido);
  assert.equal(bad.status().estado, 'erro');
  const m = await f.controller.create();
  assert(m);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt');
  const unavailable = new RecurringBackupService({
    root: f.root,
    backup: f.controller,
    chooseFolder: async () => undefined,
  });
  t.after(() => unavailable.stop());
  await unavailable.start(Promise.reject(Error('External startup status failure')));
  assert(unavailable.status().devido);
  assert.equal(unavailable.status().estado, 'erro');
  assert(
    await f.controller.create(),
    'Startup policy failure must not leave manual completion waiting forever',
  );
});

test('Recurring failures: denied access, space, removed media and false publication proof never satisfy due state', async (t) => {
  const f = await fixture(t),
    s = f.service;
  await s.configure({ habilitado: false, retencao: 7 });
  await s.selectFolder();
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05']) {
    f.day(d);
    await s.use();
  }
  const before = snapshot(f.db),
    jobs = require('../dist/electron/services/backup/jobs'),
    real = jobs.backupJob;
  try {
    for (const code of ['EACCES', 'ENOSPC', 'ENODEV']) {
      jobs.backupJob = async () => {
        throw Object.assign(Error('private forbidden path'), { code });
      };
      await assert.rejects(s.execute(), (e) => e.code === code);
      assert(s.status().devido);
      assert.equal(s.status().ultimoBackup, undefined);
      assert(!s.status().erro.includes('private'));
      assert.equal(snapshot(f.db), before);
    }
    jobs.backupJob = async (task) => {
      const r = await real(task);
      return task.task === 'package' ? { ...r, sha256: '0'.repeat(64) } : r;
    };
    await assert.rejects(s.execute(), (e) => e.code === 'PUBLISH_FAILED');
    assert(s.status().devido);
    assert.equal(s.status().ultimoBackup, undefined);
  } finally {
    jobs.backupJob = real;
  }
  await s.execute();
  assert(!s.status().devido);
  assert.equal(s.status().ultimoBackup.tipo, 'manual');
  assert.equal(snapshot(f.db), before);
});

test('Recurring six fixed IPC methods validate sender, main frame, URL and arity before any operation', async () => {
  const vm = require('node:vm'),
    handlers = new Map();
  let called = 0;
  const sandbox = {
    exports: {},
    require: (name) =>
      name === 'electron'
        ? { ipcMain: { handle: (c, h) => handlers.set(c, h) } }
        : require(path.resolve('dist/electron/ipc', name)),
  };
  vm.runInNewContext(fs.readFileSync('dist/electron/ipc/backup-recorrente.js', 'utf8'), sandbox);
  const service = Object.fromEntries(
    ['status', 'use', 'selectFolder', 'configure', 'execute', 'defer'].map((n) => [
      n,
      () => {
        called++;
        return null;
      },
    ]),
  );
  const frame = { url: 'mnr://app/index.html#/dashboard' },
    window = { webContents: { mainFrame: frame } };
  sandbox.exports.registerRecurringBackup(window, 'mnr://app/index.html', service);
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
    const r = await handler(
      event,
      ...(channel.endsWith(':configurar') || channel.endsWith(':adiar')
        ? []
        : [{ path: 'C:/arbitrary', sql: 'SELECT *' }]),
    );
    assert.equal(r.ok, false);
    assert(!/SELECT|C:\\|stack|sqlite/i.test(r.error.message));
    assert.equal((await handler(event, {}, {})).ok, false);
  }
  assert.equal(called, 0);
});

test('Recurring real child termination before/after publication and during day persistence recovers conservatively', async (t) => {
  const { spawnSync } = require('node:child_process');
  for (const phase of ['before-publication', 'after-publication', 'day-write']) {
    const f = await fixture(t),
      before = snapshot(f.db);
    const r = spawnSync(
      process.execPath,
      ['tests/helpers/backup-auto-crash.cjs', f.root, f.outputs, phase],
      { encoding: 'utf8', timeout: 60000 },
    );
    assert.ifError(r.error);
    assert.equal(r.status, 77, r.stdout + r.stderr);
    const service = new RecurringBackupService({
      root: f.root,
      backup: f.controller,
      chooseFolder: async () => f.outputs,
      now: () => new Date('2026-11-05T14:00:00'),
    });
    t.after(() => service.stop());
    await service.start();
    assert.equal(snapshot(f.db), before);
    if (phase === 'after-publication') {
      assert(!service.status().devido);
      assert.equal(service.status().ultimoBackup.tipo, 'automatico');
    } else {
      assert(service.status().devido);
      assert.equal(service.status().ultimoBackup, undefined);
      await service.selectFolder();
      await service.execute();
      assert(!service.status().devido);
    }
    service.stop();
    const again = new RecurringBackupService({
      root: f.root,
      backup: f.controller,
      chooseFolder: async () => undefined,
      now: () => new Date('2026-11-05T14:00:00'),
    });
    t.after(() => again.stop());
    await again.start();
    await again.use();
    assert(
      !again.status().devido,
      'Known interrupted staging must not trigger the same obligation forever',
    );
    assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  }
});
