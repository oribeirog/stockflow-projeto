const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const { resolve, join, relative, isAbsolute } = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { release, cpus } = require('node:os');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const { command } = require('../tests/helpers/consolidacao-fixture.cjs');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { createFotoService } = require('../dist/electron/services/fotos');
const { createCatalogService } = require('../dist/electron/services/catalogos');
const { recoverAndOpen } = require('../dist/electron/services/backup/control');
const jobs = require('../dist/electron/services/backup/jobs');
const { BackupController } = require('../dist/electron/services/backup/controller');
fs.mkdirSync('.local-data/test', { recursive: true });
const root = fs.mkdtempSync(resolve('.local-data/test/backup-benchmark-'));
app.setPath('userData', join(root, 'profile'));
app.on('window-all-closed', () => {});
app
  .whenReady()
  .then(async () => {
    const checkpoints = JSON.parse(fs.readFileSync('.cache/benchmark-4g3-consultas.json', 'utf8')),
      result = {
        createdAt: new Date().toISOString(),
        os: release(),
        cpu: cpus()[0].model,
        runtime: process.versions,
        root,
        samples: [],
        source:
          'Validated read-only 4G3 fixtures created with official services; fixture/photo preparation excluded from timings',
      },
      originalJob = jobs.backupJob;
    let timings = [],
      peak = 0;
    jobs.backupJob = async (task) => {
      const start = performance.now();
      let value;
      try {
        value = await originalJob(task);
        return value;
      } finally {
        timings.push({
          task: task.task,
          ms: performance.now() - start,
          processRss: process.memoryUsage().rss,
          captureMs: value?.captureMs,
          photoMs: value?.photoMs,
        });
      }
    };
    const observe = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 10);
    try {
      for (const [index, volume] of [50, 200, 500].entries()) {
        const source = checkpoints.samples.find((s) => s.vendas === volume).checkpoint,
          rel = relative(resolve('.local-data/test'), resolve(source));
        assert(!rel.startsWith('..') && !isAbsolute(rel));
        const fixture = join(root, String(volume)),
          data = join(fixture, 'data'),
          images = join(fixture, 'images');
        fs.mkdirSync(data, { recursive: true });
        fs.mkdirSync(images);
        const old = new Database(join(source, 'mnr-perfumes.db'), {
          readonly: true,
          fileMustExist: true,
        });
        try {
          const bytes = old.serialize();
          assert(bytes.length < 50 * 1024 ** 2);
          fs.writeFileSync(join(data, 'mnr-perfumes.db'), bytes, { flag: 'wx' });
        } finally {
          old.close();
        }
        const db = await openDatabase(data, 'benchmark'),
          cat = createCatalogService(db, 'benchmark'),
          base = db
            .prepare('SELECT id,marca_id,categoria_id FROM produtos ORDER BY id LIMIT 1')
            .get(),
          dimension = index === 2 ? 2048 : 1024,
          bitmap = randomBytes(dimension * dimension * 4);
        for (let i = 3; i < bitmap.length; i += 4) bitmap[i] = 255;
        const image = nativeImage.createFromBitmap(bitmap, { width: dimension, height: dimension }),
          bytes = image.toJPEG(85),
          thumb = image.resize({ width: 160 }).toJPEG(80),
          count = [2, 10, 30][index],
          photos = createFotoService(db, images, 'benchmark', () => ({
            mime: 'image/jpeg',
            image: bytes,
            thumb,
            size: { width: dimension, height: dimension },
            thumbSize: { width: 160, height: 160 },
          }));
        for (let n = 0; n < count; n++) {
          const product = cat.saveProduct(
              command({
                nome: 'Fotografia benchmark ' + n,
                sku: 'BK-PHOTO-' + n,
                marcaId: base.marca_id,
                categoriaId: base.categoria_id,
                volumeMicrolitros: 1000,
                precoVendaCentavos: 1000,
                estoqueMinimo: 0,
              }),
            ),
            token = await photos.prepare(bytes, 1);
          await photos.save(command({ produtoId: product.id, token: token.token }), 1);
        }
        const before = snapshot(db),
          archive = join(root, volume + '.mnrbackup'),
          photoHash = createHash('sha256').update(bytes).digest('hex');
        const controller = new BackupController({
          root: fixture,
          db,
          photos,
          version: 'benchmark',
          protectedRoots: [fixture],
          chooseBackup: async () => archive,
          chooseRestore: async () => archive,
          restart: () => {},
          openProtections: async () => {},
        });
        timings = [];
        peak = process.memoryUsage().rss;
        let start = performance.now();
        const created = await controller.create(),
          backupMs = performance.now() - start;
        cat.savePerson('CLIENTE', command({ nome: 'After backup' }));
        start = performance.now();
        const review = await controller.inspect(),
          inspectionMs = performance.now() - start;
        start = performance.now();
        await controller.restore({ token: review.token, confirmacao: 'RESTAURAR' });
        const preparationMs = performance.now() - start;
        db.close();
        start = performance.now();
        const opened = await recoverAndOpen(fixture, 'benchmark'),
          reopenMs = performance.now() - start;
        assert.equal(snapshot(opened.db), before);
        const rows = opened.db
          .prepare('SELECT a.* FROM foto_arquivos a JOIN produto_fotos p ON p.foto_id=a.id')
          .all();
        assert.equal(rows.length, count);
        for (const photo of rows)
          assert.equal(
            createHash('sha256')
              .update(fs.readFileSync(join(opened.images, 'objects', photo.id + '.image')))
              .digest('hex'),
            photoHash,
          );
        createCatalogService(opened.db, 'benchmark').savePerson(
          'CLIENTE',
          command({ nome: 'New operation after restore' }),
        );
        const dbBytes = fs.statSync(opened.db.name).size;
        opened.db.close();
        result.samples.push({
          vendas: volume,
          fotos: count,
          photoBytes: count * (bytes.length + thumb.length),
          largestPhotoBytes: bytes.length,
          dbBytes,
          archiveBytes: created.bytes,
          backupMs,
          inspectionMs,
          preparationMs,
          reopenMs,
          peakProcessRss: peak,
          workerSteps: timings,
          spaceEstimateBytes: 5 * created.bytes,
        });
        fs.writeFileSync('.cache/benchmark-5-1-backup.json', JSON.stringify(result, null, 2));
        console.log('BACKUP_BENCHMARK_ROUNDTRIP_OK', volume, count, created.bytes);
      }
    } finally {
      clearInterval(observe);
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
