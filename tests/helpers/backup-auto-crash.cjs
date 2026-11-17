const path = require('node:path');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createFotoService } = require('../../dist/electron/services/fotos');
const { BackupController } = require('../../dist/electron/services/backup/controller');
const { RecurringBackupService } = require('../../dist/electron/services/backup/recurring');
(async () => {
  const [root, output, phase] = process.argv.slice(2);
  if (!path.resolve(root).startsWith(path.resolve('.local-data/test') + path.sep))
    throw Error('Unisolated test');
  const db = await openDatabase(path.join(root, 'data'), 'test');
  const photos = createFotoService(db, path.join(root, 'images'), 'child', () => {
    throw Error('No image writes in this test');
  });
  const backup = new BackupController({
    root,
    db,
    photos,
    version: 'child',
    protectedRoots: [root],
    chooseBackup: async () => undefined,
    chooseRestore: async () => undefined,
    restart: () => {},
    openProtections: async () => {},
  });
  let day = '2026-11-02';
  const s = new RecurringBackupService({
    root,
    backup,
    chooseFolder: async () => output,
    now: () => new Date(day + 'T12:00:00'),
  });
  await s.start();
  if (phase === 'before-publication') {
    const original = s.prepared.bind(s);
    s.prepared = async (p) => {
      await original(p);
      process.exit(77);
    };
  }
  if (phase === 'after-publication') s.completed = async () => process.exit(77);
  if (phase !== 'day-write') await s.selectFolder();
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05']) {
    if (phase === 'day-write' && d === '2026-11-05')
      require('../../dist/electron/services/backup/io').moveDurable = async () => process.exit(77);
    day = d;
    await s.use();
  }
  setTimeout(() => process.exit(2), 30000);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
