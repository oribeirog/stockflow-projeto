const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolve, join } = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { createCatalogService } = require('../dist/electron/services/catalogos');
const { snapshot } = require('./helpers/financeiro-consulta-fixture.cjs');
const { command } = require('./helpers/consolidacao-fixture.cjs');
const { legacyFixture } = require('./helpers/catalogo-v5-fixture.cjs');
function projected(db) {
  return new Map(
    JSON.parse(snapshot(db))
      .filter(([name]) => name !== 'schema_migrations')
      .map(([name, rows]) => [
        name,
        rows.map((row) => {
          const r = { ...row };
          if (name === 'produtos') delete r.unidade_comercial;
          if (name === 'itens_documento') delete r.unidade_historica;
          return r;
        }),
      ]),
  );
}
function expected5(value) {
  return new Map(JSON.parse(value).filter(([name]) => name !== 'schema_migrations'));
}
async function migrated(t) {
  const old = await legacyFixture(),
    root = fs.mkdtempSync(resolve('.local-data/test/pre52a-test-'));
  for (const dir of ['data', 'images'])
    fs.cpSync(join(old.root, dir), join(root, dir), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const db = await openDatabase(join(root, 'data'), 'test', undefined, join(root, 'images'));
  t.after(() => {
    if (db.open) db.close();
  });
  return { old, root, db, cat: createCatalogService(db, 'test') };
}

test('Pré-5.2 A: official 5→6 migration preserves complete historical tables, identities, triggers and sequences', async (t) => {
  const { old, db, root } = await migrated(t);
  assert.equal(db.pragma('user_version', { simple: true }), 6);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(projected(db), expected5(old.stateB));
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(), old.sequencesB);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert(
    db.prepare('SELECT count(*) n FROM produtos WHERE unidade_comercial<>?').get('UN').n === 0,
  );
  const after = snapshot(db);
  db.close();
  const again = await openDatabase(join(root, 'data'), 'test', undefined, join(root, 'images'));
  try {
    assert.equal(snapshot(again), after);
    assert.equal(
      again.prepare('SELECT count(*) n FROM schema_migrations WHERE versao=6').get().n,
      1,
    );
  } finally {
    again.close();
  }
});

test('Pré-5.2 A: universal products, exact barcode text, immutable units, legacy replay and preservation', async (t) => {
  const { old, db, cat } = await migrated(t),
    before = snapshot(db);
  assert.deepEqual(cat.saveProduct(old.legacyCommand), old.legacyResult);
  assert.equal(snapshot(db), before);
  const base = {
    nome: 'Carteira à mão',
    sku: 'GENERAL-CX',
    marcaId: old.legacyResult.marcaId,
    categoriaId: old.legacyResult.categoriaId,
    precoVendaCentavos: 1234,
    estoqueMinimo: 2,
    codigoBarras: '0000000123',
    unidadeComercial: 'CX',
    descricao: 'Informação geral '.repeat(100),
  };
  const saved = cat.saveProduct(command(base));
  assert.equal(saved.unidadeComercial, 'CX');
  assert(!Object.hasOwn(saved, 'volumeMicrolitros'));
  assert(!Object.hasOwn(saved, 'concentracao'));
  assert.deepEqual(
    db.prepare('SELECT volume_microlitros,concentracao FROM produtos WHERE id=?').get(saved.id),
    { volume_microlitros: null, concentracao: null },
  );
  for (const busca of ['carteira a mao', 'general-cx', '0000000123'])
    assert(cat.listProducts({ busca }).some((p) => p.id === saved.id));
  assert(!cat.listProducts({ busca: '000000123' }).some((p) => p.id === saved.id));
  for (const dados of [
    { ...base, sku: 'OTHER', codigoBarras: '0000000123' },
    { ...base, sku: 'GENERAL-CX', codigoBarras: null },
  ])
    assert.throws(
      () => cat.saveProduct(command(dados)),
      (e) => e.code === 'CONFLICT',
    );
  for (const unidadeComercial of ['KG', '', 1, 'un', null])
    assert.throws(
      () => cat.saveProduct(command({ ...base, sku: 'BAD', codigoBarras: null, unidadeComercial })),
      (e) => e.code === 'VALIDATION',
    );
  assert.throws(
    () => cat.saveProduct(command({ ...base, id: saved.id, unidadeComercial: 'UN' })),
    (e) => e.code === 'VALIDATION',
  );
  cat.saveProduct(command({ ...base, id: saved.id, ativo: false }));
  assert.throws(
    () => cat.saveProduct(command({ ...base, sku: 'BARCODE-INACTIVE' })),
    (e) => e.code === 'CONFLICT',
  );
  const simple = cat.saveProduct(
    command({ ...base, sku: 'GENERAL-UN', codigoBarras: null, unidadeComercial: undefined }),
  );
  assert.equal(simple.unidadeComercial, 'UN');
  assert.throws(
    () =>
      cat.saveProduct(
        command({ ...base, sku: 'FAKE-VOLUME', codigoBarras: null, volumeMicrolitros: 1 }),
      ),
    (e) => e.code === 'VALIDATION',
  );
  const legacy = cat.getProduct(old.legacyResult.id),
    { criadoEm, atualizadoEm, ...edit } = legacy;
  void criadoEm;
  void atualizadoEm;
  cat.saveProduct(command({ ...edit, nome: 'Produto legado editado' }));
  assert.deepEqual(
    db.prepare('SELECT volume_microlitros,concentracao FROM produtos WHERE id=?').get(legacy.id),
    { volume_microlitros: 50000, concentracao: 'EDP' },
  );
});

test('Pré-5.2 A: approved schema-5 archive is strictly validated before isolated official staging migration', async (t) => {
  const { old, root } = await migrated(t),
    { newOwnedSet } = require('../dist/electron/services/backup/control'),
    { prepareArchive, validateSet } = require('../dist/electron/services/backup/format'),
    { hashFile } = require('../dist/electron/services/backup/io');
  const staging = await newOwnedSet(root, 'work'),
    target = await newOwnedSet(root, 'sets'),
    before = await hashFile(old.archive),
    info = await prepareArchive(old.archive, staging.path, target.path);
  assert.equal(info.schema, 6);
  assert.equal(info.schemaOrigem, 5);
  assert.deepEqual(await hashFile(old.archive), before);
  assert.equal(before.sha256, old.archiveSha256);
  assert.equal((await validateSet(target.path)).manifest.schema, 6);
  const db = new Database(join(target.path, 'data/mnr-perfumes.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.deepEqual(projected(db), expected5(old.stateA));
    assert.deepEqual(
      db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
      old.sequencesA,
    );
    assert.equal(
      db.prepare('SELECT count(*) n FROM produtos WHERE sku=?').get('LEGACY-B-ONLY').n,
      0,
    );
  } finally {
    db.close();
  }
});

async function legacyPending(t) {
  const old = await legacyFixture(),
    { approvedRuntime } = require('./helpers/approved-v5.cjs'),
    base = approvedRuntime();
  const root = fs.mkdtempSync(resolve('.local-data/test/pre52a-pending-'));
  for (const dir of ['data', 'images'])
    fs.cpSync(join(old.root, dir), join(root, dir), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const { openDatabase: open5 } = require(join(base, 'dist/electron/infrastructure/database'));
  const db = await open5(join(root, 'data'), 'test', undefined, join(root, 'images'));
  const { createFotoService } = require(join(base, 'dist/electron/services/fotos'));
  const { BackupController } = require(join(base, 'dist/electron/services/backup/controller'));
  const controller = new BackupController({
    root,
    db,
    photos: createFotoService(db, join(root, 'images'), 'test'),
    version: 'test',
    protectedRoots: [root],
    chooseBackup: async () => undefined,
    chooseRestore: async () => old.archive,
    restart: () => {},
    openProtections: async () => {},
  });
  const review = await controller.inspect();
  assert.equal(review.schema, 5);
  await controller.restore({ token: review.token, confirmacao: 'RESTAURAR' });
  db.close();
  const { recoveryPaths } = require('../dist/electron/services/backup/control'),
    p = recoveryPaths(root);
  const files = [
    p.pending,
    join(p.plans, review.token + '.json'),
    join(p.sets, review.token, 'manifest.json'),
    join(p.protection, review.token + '.mnrbackup'),
  ];
  const hashes = files.map((file) =>
    require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  );
  return { old, root, review, p, files, hashes };
}

test('Pré-5.2 A: approved 5.1 pending journal migrates privately, restores A on first start, preserves B and immutable source', async (t) => {
  const { old, root, review, p, files, hashes } = await legacyPending(t);
  const { recoverAndOpen, selection } = require('../dist/electron/services/backup/control');
  const active = await recoverAndOpen(root, 'test');
  try {
    assert.equal(active.db.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(projected(active.db), expected5(old.stateA));
    assert.equal(
      active.db.prepare('SELECT count(*) n FROM produtos WHERE sku=?').get('LEGACY-B-ONLY').n,
      0,
    );
    assert.notEqual(await selection(root), review.token);
    const done = JSON.parse(fs.readFileSync(join(p.plans, review.token + '.done.json')));
    assert.equal(done.status, 'restaurado');
    assert.equal(done.geracao, await selection(root));
    assert.equal(fs.existsSync(p.pending), false);
    for (let i = 1; i < files.length; i++)
      assert.equal(
        require('node:crypto').createHash('sha256').update(fs.readFileSync(files[i])).digest('hex'),
        hashes[i],
      );
  } finally {
    active.db.close();
  }
  const again = await recoverAndOpen(root, 'test');
  try {
    assert.deepEqual(projected(again.db), expected5(old.stateA));
  } finally {
    again.db.close();
  }
  const { newOwnedSet } = require('../dist/electron/services/backup/control'),
    { inspectArchive } = require('../dist/electron/services/backup/format');
  const copy = await newOwnedSet(root, 'work');
  await inspectArchive(files[3], copy.path);
  const protectedDb = new Database(join(copy.path, 'data/mnr-perfumes.db'), { readonly: true });
  try {
    assert.deepEqual(projected(protectedDb), expected5(old.stateB));
  } finally {
    protectedDb.close();
  }
});

test('Pré-5.2 A: legacy pending upgrade survives loss before/after pointer and after durable completion', async (t) => {
  const { spawnSync } = require('node:child_process'),
    { recoverAndOpen } = require('../dist/electron/services/backup/control');
  const restoreDiagnostics =
    require('./helpers/backup-recovery-diagnostics.cjs').recoveryDiagnostics();
  t.after(restoreDiagnostics);
  for (const phase of ['before-pointer', 'after-pointer', 'after-open', 'after-commit']) {
    const { old, root, p, review } = await legacyPending(t);
    const child = spawnSync(
      process.execPath,
      ['tests/helpers/backup-recovery-child.cjs', root, phase],
      { encoding: 'utf8', timeout: 60000, windowsHide: true },
    );
    assert.equal(child.status, 42, phase + ' ' + child.stderr);
    const active = await recoverAndOpen(root, 'test');
    try {
      assert.deepEqual(
        projected(active.db),
        expected5(phase === 'after-open' ? old.stateB : old.stateA),
        phase,
      );
      assert.equal(active.db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(active.db.pragma('foreign_key_check'), []);
    } finally {
      active.db.close();
    }
    const again = await recoverAndOpen(root, 'test');
    try {
      assert.deepEqual(
        projected(again.db),
        expected5(phase === 'after-open' ? old.stateB : old.stateA),
      );
    } finally {
      again.db.close();
    }
    assert(fs.existsSync(join(p.protection, review.token + '.mnrbackup')));
  }
});

test('Pré-5.2 A: 0006 failures roll back all tables, sequences, schema, identity and foreign-key enforcement', async (t) => {
  const old = await legacyFixture(),
    { migrations, migrateDatabase } = require('../dist/electron/infrastructure/database/migrate');
  for (const marker of [
    'DROP TABLE produtos;',
    'SELECT * FROM mnr_produtos_0006;',
    'DROP TABLE mnr_produtos_seq_0006;',
    'END;\nALTER TABLE itens_documento',
  ]) {
    const root = fs.mkdtempSync(resolve('.local-data/test/pre52a-rollback-'));
    for (const dir of ['data', 'images'])
      fs.cpSync(join(old.root, dir), join(root, dir), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    const db = new Database(join(root, 'data/mnr-perfumes.db'));
    db.pragma('foreign_keys=ON');
    const before = snapshot(db),
      schema = db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
    let sql = migrations[5].sql;
    assert(sql.includes(marker));
    sql = sql.replace(
      marker,
      marker === 'END;\nALTER TABLE itens_documento'
        ? 'END;\nINSERT INTO missing_table VALUES(1);\nALTER TABLE itens_documento'
        : marker + '\nINSERT INTO missing_table VALUES(1);',
    );
    await assert.rejects(
      migrateDatabase(
        db,
        {
          directory: join(root, 'data'),
          existed: true,
          appVersion: 'test',
          imagesDirectory: join(root, 'images'),
        },
        [...migrations.slice(0, 5), { ...migrations[5], sql }],
      ),
    );
    assert.equal(snapshot(db), before);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('user_version', { simple: true }), 5);
    db.close();
    const again = new Database(join(root, 'data/mnr-perfumes.db'));
    try {
      assert.equal(snapshot(again), before);
      assert.equal(again.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(again.pragma('foreign_key_check'), []);
    } finally {
      again.close();
    }
  }
});

test('Pré-5.2 A: CX merchandise crosses official purchases, corrections, sales, costing, counts, reversals, indicators and XLSX without conversion', async (t) => {
  const { fixture } = require('./helpers/estoque-fixture.cjs'),
    { stockCycle, clock, day } = require('./helpers/consolidacao-estoque-fixture.cjs'),
    f = await fixture(t);
  const s = stockCycle(f.db, { unidadeComercial: 'CX', nome: 'Carteira e acessórios' });
  for (const [, run] of s.steps) {
    run();
    assert(s.stock.reconciliarEstoque().consistente);
    assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  }
  const rows = f.db
    .prepare(
      "SELECT i.* FROM itens_documento i JOIN documentos d ON d.id=i.documento_id WHERE d.estado IN ('CONFIRMADO','ESTORNADO')",
    )
    .all();
  assert(rows.length > 8);
  assert(rows.every((i) => i.unidade_historica === 'CX'));
  const sale = s.com.consultar(s.state.sale.id);
  assert.equal(sale.itens[0].unidadeHistorica, 'CX');
  assert.equal(sale.itens[0].valorCustoEstoqueCentavos, 9000);
  const { createStockQueryService } = require('../dist/electron/services/estoque-consulta'),
    query = createStockQueryService(f.db, 'test');
  assert.equal(query.obter(s.productId).unidadeComercial, 'CX');
  const { createReportService } = require('../dist/electron/services/relatorios'),
    r = createReportService(f.db, clock),
    before = snapshot(f.db);
  f.db.pragma('query_only=ON');
  const page = r.listarSaldos({ limite: 200 });
  const cycleIds = [s.productId, s.manual.id, s.cancelProduct.id];
  assert.equal(page.itens.filter((p) => cycleIds.includes(p.produtoId)).length, 3);
  assert(
    page.itens
      .filter((p) => cycleIds.includes(p.produtoId))
      .every((p) => p.unidadeComercial === 'CX'),
  );
  assert.equal(page.itens.find((p) => p.produtoId === f.product.id).unidadeComercial, 'UN');
  const { coletarDocumento } = require('../dist/electron/services/exportacoes/documento'),
    d = coletarDocumento(f.db, { modelo: 'ESTOQUE', filtros: {} }, clock);
  f.db.pragma('query_only=OFF');
  assert.equal(snapshot(f.db), before);
  const section = d.secoes.find((x) => x.nome === 'Estoque');
  assert.equal(section.colunas[3].titulo, 'Unidade');
  assert(section.linhas.filter((row) => cycleIds.includes(row[0])).every((row) => row[3] === 'CX'));
  const { gerarExcel } = require('../dist/electron/services/exportacoes/xlsx'),
    ExcelJS = require('exceljs');
  const bytes = await gerarExcel(d);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  assert(workbook.worksheets.some((sheet) => sheet.getSheetValues().flat(2).includes('CX')));
  const summary = r.obterResumoEstoque({ dataInicio: day, dataFim: day });
  assert.equal(summary.posicaoAtual.valorCentavos, page.totais.valorCentavos);
});

test('Pré-5.2 A: killed migration preserves complete schema-5 WAL data and can migrate once after reopen', async () => {
  const old = await legacyFixture(),
    { spawnSync } = require('node:child_process'),
    root = fs.mkdtempSync(resolve('.local-data/test/pre52a-killed-migration-'));
  for (const dir of ['data', 'images'])
    fs.cpSync(join(old.root, dir), join(root, dir), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const killed = spawnSync(process.execPath, ['tests/helpers/catalogo-migration-child.cjs', root], {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  assert.equal(killed.status, 42, killed.stderr);
  const original = new Database(join(root, 'data/mnr-perfumes.db'));
  try {
    assert.equal(original.pragma('user_version', { simple: true }), 5);
    assert.equal(snapshot(original), old.stateB);
    assert.equal(original.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(original.pragma('foreign_key_check'), []);
  } finally {
    original.close();
  }
  const db = await openDatabase(join(root, 'data'), 'test', undefined, join(root, 'images'));
  try {
    assert.deepEqual(projected(db), expected5(old.stateB));
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations WHERE versao=6').get().n, 1);
  } finally {
    db.close();
  }
});

test('Pré-5.2 A: schema-5 SQL tampering with recomputed component hashes is rejected before any migration', async () => {
  const old = await legacyFixture(),
    root = fs.mkdtempSync(resolve('.local-data/test/pre52a-hostile-v5-'));
  const { newOwnedSet } = require('../dist/electron/services/backup/control'),
    {
      inspectArchive,
      prepareArchive,
      readArchive,
      encodeManifest,
    } = require('../dist/electron/services/backup/format'),
    { hashFile } = require('../dist/electron/services/backup/io');
  const source = await newOwnedSet(root, 'work');
  await inspectArchive(old.archive, source.path);
  const dbPath = join(source.path, 'data/mnr-perfumes.db'),
    bad = new Database(dbPath);
  bad.exec('DROP TRIGGER produtos_sem_exclusao');
  bad.close();
  const manifest = await readArchive(old.archive),
    actual = await hashFile(dbPath);
  manifest.files = manifest.files.map((f) =>
    f.path === 'data/mnr-perfumes.db' ? { ...f, ...actual } : f,
  );
  const zip = new (require('yazl').ZipFile)();
  zip.addBuffer(encodeManifest(manifest), 'manifest.json', { compress: false, mode: 0o100600 });
  for (const f of manifest.files)
    zip.addFile(join(source.path, f.path), f.path, { compress: false, mode: 0o100600 });
  zip.end();
  const archive = join(root, 'adulterado.mnrbackup');
  await require('node:stream/promises').pipeline(
    zip.outputStream,
    fs.createWriteStream(archive, { flags: 'wx' }),
  );
  await readArchive(archive);
  const staging = await newOwnedSet(root, 'work'),
    target = await newOwnedSet(root, 'sets');
  await assert.rejects(
    prepareArchive(archive, staging.path, target.path),
    (e) => e.code === 'INVALID_BACKUP',
  );
  const copy = new Database(dbPath, { readonly: true });
  try {
    assert.equal(copy.pragma('user_version', { simple: true }), 5);
    assert.deepEqual(projected(copy), expected5(old.stateA));
  } finally {
    copy.close();
  }
  assert.equal((await hashFile(old.archive)).sha256, old.archiveSha256);
  assert.equal(fs.existsSync(join(target.path, 'data/mnr-perfumes.db')), false);
});

test('Pré-5.2 A: previously active 5.1 generation migrates safely with long Windows pre-migration photo protection paths', async (t) => {
  const { old, root, p } = await legacyPending(t),
    { approvedRuntime } = require('./helpers/approved-v5.cjs');
  const oldControl = require(join(approvedRuntime(), 'dist/electron/services/backup/control'));
  const activated5 = await oldControl.recoverAndOpen(root, 'test');
  assert.equal(activated5.db.pragma('user_version', { simple: true }), 5);
  activated5.db.close();
  const { recoverAndOpen, selection } = require('../dist/electron/services/backup/control'),
    id = await selection(root),
    upgraded = await recoverAndOpen(root, 'test');
  try {
    assert.equal(upgraded.db.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(projected(upgraded.db), expected5(old.stateA));
    assert.equal(await selection(root), id);
    const backups = join(p.sets, id, 'data/backups'),
      asset = fs.readdirSync(backups).find((n) => n.endsWith('.assets'));
    assert(asset);
    const protectedFile = join(backups, asset, 'data/mnr-perfumes.db');
    assert(protectedFile.length >= 240);
    const { sqlitePath } = require('../dist/electron/infrastructure/database/sqlite-path'),
      protectedDb = new Database(sqlitePath(protectedFile), {
        readonly: true,
        fileMustExist: true,
      });
    try {
      assert.equal(protectedDb.pragma('user_version', { simple: true }), 5);
      assert.deepEqual(projected(protectedDb), expected5(old.stateA));
    } finally {
      protectedDb.close();
    }
    const { newOwnedSet } = require('../dist/electron/services/backup/control'),
      { captureSet, validateSet } = require('../dist/electron/services/backup/format'),
      set = await newOwnedSet(root, 'work');
    await captureSet(upgraded.db.name, upgraded.images, set.path, 'test');
    assert.equal((await validateSet(set.path)).manifest.schema, 6);
  } finally {
    upgraded.db.close();
  }
  const again = await recoverAndOpen(root, 'test');
  try {
    assert.deepEqual(projected(again.db), expected5(old.stateA));
  } finally {
    again.db.close();
  }
});

test('Pré-5.2 A: transient native Windows lock releases safely before durable pointer publication; existing backup is never overwritten', async () => {
  const { spawn } = require('node:child_process'),
    { durableJson, moveDurable } = require('../dist/electron/services/backup/io'),
    root = fs.mkdtempSync(resolve('.local-data/test/pre52a-lock-test-')),
    target = join(root, 'active.json');
  fs.writeFileSync(target, JSON.stringify({ state: 'previous' }), { flag: 'wx' });
  const script =
    "$h=[IO.File]::Open($env:MNR_TEST_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);[Console]::WriteLine('LOCKED');Start-Sleep -Milliseconds 1800;$h.Dispose()";
  const child = spawn(
    join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      env: { ...process.env, MNR_TEST_LOCK: target },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (b) => {
        if (b.toString().includes('LOCKED')) resolve();
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code) reject(Error('Lock holder failed ' + code));
      });
    });
    await durableJson(target, { state: 'restored' }, true);
    await new Promise((resolve) =>
      child.exitCode !== null ? resolve() : child.once('exit', resolve),
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(target)), { state: 'restored' });
    const source = join(root, 'source');
    fs.writeFileSync(source, 'new', { flag: 'wx' });
    await assert.rejects(moveDurable(source, target), (e) => e.code === 'EEXIST');
    assert.deepEqual(JSON.parse(fs.readFileSync(target)), { state: 'restored' });
    assert.equal(fs.readFileSync(source, 'utf8'), 'new');
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('Pré-5.2 A: purchase and sale drafts retain CX from first save through physical reopen and idempotent replay', async (t) => {
  const { fixture, cadastro } = require('./helpers/estoque-fixture.cjs'),
    { createCommercialService } = require('../dist/electron/services/comercial'),
    f = await fixture(t);
  const p = f.catalog.saveProduct(
      cadastro({ ...f.productData, sku: 'CX-DRAFT', unidadeComercial: 'CX' }),
    ),
    service = createCommercialService(f.db, 'test'),
    commands = [],
    ids = [];
  for (const tipo of ['COMPRA', 'VENDA']) {
    const command = cadastro({
      tipo,
      dataComercial: '2026-11-01',
      ...(tipo === 'VENDA' ? { modalidadeVenda: 'A_VISTA' } : {}),
      itens: [{ produtoId: p.id, quantidade: 2, valorUnitarioCentavos: 2000 }],
    });
    const d = service.salvarRascunho(command);
    assert.equal(d.itens[0].unidadeHistorica, 'CX');
    assert.equal(d.totalCentavos, 4000);
    assert.equal(d.itens[0].quantidade, 2);
    assert.equal(d.itens[0].valorCustoEstoqueCentavos, 0);
    assert.deepEqual(service.salvarRascunho(command), d);
    commands.push({ command, result: d });
    ids.push(d.id);
  }
  const before = snapshot(f.db);
  f.db.close();
  const again = await openDatabase(f.directory, 'test');
  try {
    const q = createCommercialService(again, 'test');
    for (const id of ids) assert.equal(q.consultar(id).itens[0].unidadeHistorica, 'CX');
    for (const c of commands) assert.deepEqual(q.salvarRascunho(c.command), c.result);
    assert.equal(snapshot(again), before);
    assert.equal(again.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(again.pragma('foreign_key_check'), []);
  } finally {
    again.close();
  }
});
