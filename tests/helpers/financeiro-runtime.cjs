// Shared acceptance scenario executed by Node tests and by the real Electron runtime.
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { join } = require('node:path');
const { mkdirSync, readdirSync } = require('node:fs');
const {
  migrations,
  migrateDatabase,
  checkIntegrity,
} = require('../../dist/electron/infrastructure/database/migrate');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { createStockService } = require('../../dist/electron/services/estoque');
const { createCommercialService } = require('../../dist/electron/services/comercial');
const { createFinancialService } = require('../../dist/electron/services/financeiro');
const { createCorrectionService } = require('../../dist/electron/services/correcoes');
const { reconciliarComercial } = require('../../dist/electron/services/comercial-reconciliation');
const cmd = (id, dados) => ({ operacaoId: id, motivo: 'Aceitação 3D', dados });
const rows = (db, name) => db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all();
async function verifyFinanceiroRuntime(directory) {
  mkdirSync(directory, { recursive: true });
  for (const version of [1, 2, 3]) {
    const dir = join(directory, `v${version}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'populated.db');
    let db = new Database(path);
    try {
      db.pragma('foreign_keys=ON');
      db.pragma('journal_mode=WAL');
      db.pragma('trusted_schema=OFF');
      await migrateDatabase(
        db,
        { directory: dir, existed: false, appVersion: 'old' },
        migrations.slice(0, version),
      );
      const c = createCatalogService(db, 'old'),
        brand = c.saveReference('MARCA', cmd('b', { nome: 'Marca' })),
        category = c.saveReference('CATEGORIA', cmd('cat', { nome: 'Categoria' }));
      const p = c.saveProduct(
        cmd('p', {
          sku: 'P',
          nome: 'Perfume',
          marcaId: brand.id,
          categoriaId: category.id,
          volumeMicrolitros: 1000,
          precoVendaCentavos: 10000,
          estoqueMinimo: 0,
        }),
      );
      const client = c.savePerson('CLIENTE', cmd('client', { nome: 'Cliente' }));
      const form = c.saveReference('FORMA_PAGAMENTO', cmd('form', { nome: 'Pix' }));
      let stock = createStockService(db, 'old');
      if (version >= 2)
        stock.registrarEntrada({
          ...cmd('stock', { produtoId: p.id, quantidade: 10, custoTotalCentavos: 1000 }),
          dataEfetiva: '2026-10-31',
        });
      if (version === 3) {
        const s = createCommercialService(db, 'old');
        const d = s.salvarRascunho(
          cmd('old-sale', {
            tipo: 'VENDA',
            clienteId: client.id,
            modalidadeVenda: 'A_VISTA',
            dataComercial: '2026-10-31',
            itens: [{ produtoId: p.id, quantidade: 1, valorUnitarioCentavos: 10000 }],
          }),
        );
        s.confirmar(
          cmd('old-confirm', {
            id: d.id,
            versaoEsperada: d.versao,
            pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 10000 }],
          }),
        );
      }
      const names = db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => r.name);
      const before = Object.fromEntries(names.map((name) => [name, rows(db, name)]));
      const schema = db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
      const seq = rows(db, 'sqlite_sequence');
      for (const marker of [
        'DROP TABLE documentos;',
        'DROP TABLE movimentacoes_estoque;',
        'CREATE TABLE reembolsos_cliente',
      ]) {
        const sql = migrations[3].sql,
          end = sql.indexOf(';', sql.indexOf(marker)) + 1;
        await assert.rejects(
          migrateDatabase(db, { directory: dir, existed: true, appVersion: '3D' }, [
            ...migrations.slice(0, 3),
            {
              ...migrations[3],
              sql: sql.slice(0, end) + '\nSELECT * FROM migration_failure;\n' + sql.slice(end),
            },
          ]),
        );
        db.close();
        db = new Database(path);
        db.pragma('foreign_keys=ON');
        assert.deepEqual(Object.fromEntries(names.map((name) => [name, rows(db, name)])), before);
        assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(), schema);
        assert.deepEqual(rows(db, 'sqlite_sequence'), seq);
        assert.equal(db.pragma('user_version', { simple: true }), version);
      }
      await migrateDatabase(db, { directory: dir, existed: true, appVersion: '3D' });
      stock = createStockService(db, '3D');
      for (const [name, old] of Object.entries(before)) {
        const actual = db
          .prepare(`SELECT ${Object.keys(old[0] ?? {}).join(',') || '*'} FROM ${name} ORDER BY 1`)
          .all();
        assert.deepEqual(name === 'schema_migrations' ? actual.slice(0, version) : actual, old);
      }
      for (const name of readdirSync(join(dir, 'backups')).filter((n) => n.endsWith('.db'))) {
        const backup = new Database(join(dir, 'backups', name), { readonly: true });
        try {
          checkIntegrity(backup);
          assert.equal(backup.pragma('user_version', { simple: true }), version);
          for (const [table, old] of Object.entries(before))
            assert.deepEqual(rows(backup, table), old);
        } finally {
          backup.close();
        }
      }
      if (version === 1)
        stock.registrarEntrada({
          ...cmd('stock', { produtoId: p.id, quantidade: 10, custoTotalCentavos: 1000 }),
          dataEfetiva: '2026-10-31',
        });
      const clock = () => new Date('2026-11-01T15:00:00Z');
      const s = createCommercialService(db, '3D', clock),
        f = createFinancialService(db, '3D', clock),
        cor = createCorrectionService(db, '3D', clock);
      const draft = s.salvarRascunho(
        cmd('new-sale', {
          tipo: 'VENDA',
          clienteId: client.id,
          modalidadeVenda: 'A_PRAZO',
          dataComercial: '2026-10-31',
          itens: [{ produtoId: p.id, quantidade: 3, valorUnitarioCentavos: 10000 }],
        }),
      );
      const sale = s.confirmarComEntrada(
        cmd('entry', {
          id: draft.id,
          versaoEsperada: draft.versao,
          pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 10000 }],
          parcelas: [
            { valorCentavos: 10000, vencimento: '2026-12-01' },
            { valorCentavos: 10000, vencimento: '2027-01-01' },
          ],
        }),
      );
      f.registrarRecebimento(
        cmd('receive', {
          vendaId: sale.id,
          dataEfetiva: '2026-11-01',
          pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 15000 }],
        }),
      );
      stock.registrarEntrada({
        ...cmd('different-average', { produtoId: p.id, quantidade: 4, custoTotalCentavos: 4000 }),
        dataEfetiva: '2026-11-01',
      });
      const balance = stock.consultarSaldo(p.id);
      const ret = cmd('return', {
        documentoId: sale.id,
        dataEfetiva: '2026-11-01',
        itens: [{ itemId: sale.itens[0].id, quantidade: 2, quantidadePerda: 2 }],
      });
      db.exec(
        "CREATE TRIGGER injected_loss BEFORE INSERT ON movimentacoes_estoque WHEN NEW.natureza='PERDA_DEVOLUCAO' BEGIN SELECT RAISE(ABORT,'fail loss'); END;",
      );
      assert.throws(() => cor.devolverVenda(ret));
      db.exec('DROP TRIGGER injected_loss');
      assert.deepEqual(stock.consultarSaldo(p.id), balance);
      const returned = cor.devolverVenda(ret);
      assert.deepEqual(cor.devolverVenda(ret), returned);
      assert.equal(stock.consultarSaldo(p.id).valorTotalCentavos, balance.valorTotalCentavos);
      assert.equal(stock.consultarSaldo(p.id).quantidade, balance.quantidade);
      const obligation = f.listarReembolsos(sale.id)[0];
      assert.equal(obligation.saldoCentavos, 15000);
      f.pagarReembolso(
        cmd('refund', {
          reembolsoId: obligation.id,
          dataEfetiva: '2026-11-01',
          pagamentos: [{ formaPagamentoId: form.id, valorCentavos: 15000 }],
        }),
      );
      assert.equal(f.consultarVenda(sale.id).saldoReceberCentavos, 0);
      assert.equal(f.consultarVenda(sale.id).reembolsosPendentesCentavos, 0);
      assert.ok(reconciliarComercial(db));
      checkIntegrity(db);
      db.close();
      db = new Database(path);
      db.pragma('foreign_keys=ON');
      assert.ok(reconciliarComercial(db));
    } finally {
      db.close();
    }
  }
}
module.exports = { verifyFinanceiroRuntime };
