// Electron runtime verification uses a new fixture directory, never a user's database.
const { app } = require('electron');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const {
  migrations,
  migrateDatabase,
  checkIntegrity,
} = require('../dist/electron/infrastructure/database/migrate.js');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');

const root = resolve('.local-data/test');
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'electron-database-'));
app.setPath('userData', directory);
app.setPath('sessionData', directory);
app.setPath('crashDumps', directory);
app
  .whenReady()
  .then(async () => {
    const foundation = new Database(join(directory, 'mnr-perfumes.db'));
    foundation.pragma('journal_mode=WAL');
    foundation.close();
    const db = await openDatabase(directory, app.getVersion());
    try {
      assert.ok(process.versions.electron);
      assert.equal(
        readdirSync(join(directory, 'backups')).filter((name) => name.endsWith('.db')).length,
        1,
      );
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
      assert.equal(db.pragma('user_version', { simple: true }), 1);
      const service = createCatalogService(db, app.getVersion());
      const cmd = (operacaoId, dados) => ({ operacaoId, motivo: 'Validação Electron', dados });
      const brand = service.saveReference('MARCA', cmd('brand', { nome: 'Marca runtime' }));
      const category = service.saveReference(
        'CATEGORIA',
        cmd('category', { nome: 'Categoria runtime' }),
      );
      const request = cmd('product', {
        sku: 'RUNTIME',
        nome: 'Produto runtime',
        marcaId: brand.id,
        categoriaId: category.id,
        volumeMicrolitros: 100000,
        precoVendaCentavos: 10001,
        estoqueMinimo: 0,
      });
      const product = service.saveProduct(request);
      assert.deepEqual(service.saveProduct(request), product);
      checkIntegrity(db);
      const copyPath = join(directory, 'runtime-backup.db');
      await db.backup(copyPath);
      const copy = new Database(copyPath, { readonly: true });
      try {
        checkIntegrity(copy);
        assert.deepEqual(
          createCatalogService(copy, app.getVersion()).getProduct(product.id),
          product,
        );
        assert.equal(copy.prepare('SELECT count(*) n FROM historico_precos').get().n, 1);
        assert.equal(copy.prepare('SELECT count(*) n FROM eventos_auditoria').get().n, 3);
      } finally {
        copy.close();
      }
      await assert.rejects(
        migrateDatabase(db, { directory, existed: true, appVersion: app.getVersion() }, [
          ...migrations,
          { version: 2, name: 'runtime-2', sql: 'CREATE TABLE rollback_test(id INTEGER) STRICT;' },
          { version: 3, name: 'runtime-3', sql: 'INSERT INTO missing_table VALUES (1)' },
        ]),
        /missing_table/,
      );
      assert.equal(db.pragma('user_version', { simple: true }), 1);
      assert.equal(
        db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='rollback_test'").get().n,
        0,
      );
      console.log(
        'DATABASE_RUNTIME_OK',
        JSON.stringify({
          electron: process.versions.electron,
          node: process.versions.node,
          sqlite: db.prepare('SELECT sqlite_version() version').get().version,
        }),
      );
    } finally {
      db.close();
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
