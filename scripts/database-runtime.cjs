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
const { createStockService } = require('../dist/electron/services/estoque.js');
const { createCommercialService } = require('../dist/electron/services/comercial.js');
const { reconciliarComercial } = require('../dist/electron/services/comercial-reconciliation.js');
const { verifyFinanceiroRuntime } = require('../tests/helpers/financeiro-runtime.cjs');
const {
  verifyMigration,
  verifyMigrationRollback,
} = require('../tests/helpers/comercial-migration.cjs');

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
    let db = await openDatabase(directory, app.getVersion());
    try {
      assert.ok(process.versions.electron);
      assert.equal(
        readdirSync(join(directory, 'backups')).filter((name) => name.endsWith('.db')).length,
        1,
      );
      assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
      assert.equal(db.pragma('user_version', { simple: true }), 4);
      assert.equal(db.pragma('trusted_schema', { simple: true }), 0);
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
          { version: 5, name: 'runtime-5', sql: 'CREATE TABLE rollback_test(id INTEGER) STRICT;' },
          { version: 6, name: 'runtime-6', sql: 'INSERT INTO missing_table VALUES (1)' },
        ]),
        /missing_table/,
      );
      assert.equal(db.pragma('user_version', { simple: true }), 4);
      assert.equal(
        db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='rollback_test'").get().n,
        0,
      );
      const stock = createStockService(db, app.getVersion());
      const movement = (id, dados) => ({ ...cmd(id, dados), dataEfetiva: '2026-10-31' });
      const entry = movement('stock-entry', {
        produtoId: product.id,
        quantidade: 3,
        custoTotalCentavos: 100,
      });
      stock.registrarEntrada(entry);
      stock.registrarSaida(movement('stock-out-1', { produtoId: product.id, quantidade: 1 }));
      stock.registrarPerda(movement('stock-loss', { produtoId: product.id, quantidade: 1 }));
      stock.registrarSaida(movement('stock-out-2', { produtoId: product.id, quantidade: 1 }));
      assert.deepEqual(
        stock.listarMovimentacoes(product.id).map((m) => m.valorDeltaCentavos),
        [100, -33, -34, -33],
      );
      assert.equal(stock.reconciliarEstoque().consistente, true);
      db.exec(
        "CREATE TRIGGER stock_failure AFTER INSERT ON eventos_auditoria BEGIN SELECT RAISE(ABORT,'runtime failure'); END",
      );
      assert.throws(() =>
        stock.registrarEntrada(
          movement('stock-fail', { produtoId: product.id, quantidade: 1, custoTotalCentavos: 1 }),
        ),
      );
      db.exec('DROP TRIGGER stock_failure');
      assert.equal(stock.consultarSaldo(product.id).quantidade, 0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM operacoes WHERE id='stock-fail'").get().n, 0);
      db.close();
      db = await openDatabase(directory, app.getVersion());
      const persisted = createStockService(db, app.getVersion());
      assert.equal(persisted.consultarSaldo(product.id).versao, 4);
      assert.equal(persisted.registrarEntrada(entry).saldo.versao, 1);
      assert.equal(persisted.consultarSaldo(product.id).versao, 4);
      const catalogs3C = createCatalogService(db, app.getVersion());
      const supplier = catalogs3C.savePerson(
        'FORNECEDOR',
        cmd('supplier', { nome: 'Fornecedor runtime' }),
      );
      const client = catalogs3C.savePerson('CLIENTE', cmd('client', { nome: 'Cliente runtime' }));
      const cash = catalogs3C.saveReference(
        'FORMA_PAGAMENTO',
        cmd('cash', { nome: 'Dinheiro runtime' }),
      );
      const commercial = createCommercialService(db, app.getVersion());
      const buy = commercial.salvarRascunho(
        cmd('buy-draft', {
          tipo: 'COMPRA',
          fornecedorId: supplier.id,
          dataComercial: '2026-10-31',
          freteCentavos: 2,
          itens: [{ produtoId: product.id, quantidade: 3, valorUnitarioCentavos: 33 }],
        }),
      );
      const confirmed = commercial.confirmar(
        cmd('buy-confirm', {
          id: buy.id,
          versaoEsperada: buy.versao,
          pagamentos: [{ formaPagamentoId: cash.id, valorCentavos: 101 }],
        }),
      );
      assert.equal(confirmed.itens[0].valorCustoEstoqueCentavos, 101);
      const credit = commercial.salvarRascunho(
        cmd('credit-draft', {
          tipo: 'VENDA',
          clienteId: client.id,
          modalidadeVenda: 'A_PRAZO',
          dataComercial: '2026-10-31',
          itens: [{ produtoId: product.id, quantidade: 1, valorUnitarioCentavos: 100 }],
        }),
      );
      const creditCommand = cmd('credit-confirm', {
        id: credit.id,
        versaoEsperada: credit.versao,
        parcelas: [
          { valorCentavos: 34, vencimento: '2026-11-01' },
          { valorCentavos: 33, vencimento: '2026-12-01' },
          { valorCentavos: 33, vencimento: '2027-01-01' },
        ],
      });
      db.exec(
        "CREATE TRIGGER commercial_failure AFTER INSERT ON parcelas_receber BEGIN SELECT RAISE(ABORT,'runtime failure'); END",
      );
      assert.throws(() => commercial.confirmar(creditCommand));
      assert.equal(persisted.consultarSaldo(product.id).quantidade, 3);
      assert.equal(
        db.prepare("SELECT count(*) n FROM operacoes WHERE id='credit-confirm'").get().n,
        0,
      );
      db.exec('DROP TRIGGER commercial_failure');
      const creditResult = commercial.confirmar(creditCommand);
      assert.equal(creditResult.itens[0].valorCustoEstoqueCentavos, 34);
      assert.equal(creditResult.recebimentosEfetivosCentavos, 0);
      assert.equal(creditResult.saldoReceberCentavos, 100);
      const sale = commercial.salvarRascunho(
        cmd('sale-draft', {
          tipo: 'VENDA',
          modalidadeVenda: 'A_VISTA',
          dataComercial: '2026-10-31',
          itens: [{ produtoId: product.id, quantidade: 1, valorUnitarioCentavos: 100 }],
        }),
      );
      const saleResult = commercial.confirmar(
        cmd('sale-confirm', {
          id: sale.id,
          versaoEsperada: sale.versao,
          pagamentos: [{ formaPagamentoId: cash.id, valorCentavos: 100 }],
        }),
      );
      assert.equal(saleResult.recebimentosEfetivosCentavos, 100);
      assert.equal(saleResult.saldoReceberCentavos, 0);
      assert.equal(reconciliarComercial(db), true);
      db.close();
      db = await openDatabase(directory, app.getVersion());
      assert.deepEqual(
        createCommercialService(db, app.getVersion()).confirmar(creditCommand),
        creditResult,
      );
      await verifyMigration(mkdtempSync(join(root, 'electron-commercial-upgrade-')));
      await verifyMigrationRollback(directory);
      await verifyFinanceiroRuntime(join(directory, 'financeiro-3d'));
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
