// Host-only fixtures. Never imported by the application or shipped in the ASAR.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const { createCommercialService } = require('../dist/electron/services/comercial.js');
const { createFinancialService } = require('../dist/electron/services/financeiro.js');
const { checkIntegrity } = require('../dist/electron/infrastructure/database/migrate.js');
const cmd = (dados) => ({ operacaoId: randomUUID(), motivo: 'Fixture isolada 4C', dados });

function prepararVinculos(db) {
  const catalog = createCatalogService(db, 'fixture-4c');
  const cliente = catalog.savePerson(
    'CLIENTE',
    cmd({
      nome: 'Vínculo cliente 4C',
      tipoPessoa: 'PF',
      documento: '52998224725',
      telefone: '11 99999-1111',
      email: 'cliente@example.com',
      endereco: 'Rua Cliente\n10',
      observacoes: 'Cliente vinculado',
    }),
  );
  const fornecedor = catalog.savePerson(
    'FORNECEDOR',
    cmd({
      nome: 'Vínculo fornecedor 4C',
      tipoPessoa: 'PJ',
      documento: '12ABC34501DE35',
      telefone: '21 99999-2222',
      email: 'fornecedor@example.com',
      endereco: 'Rua Fornecedor\n20',
      observacoes: 'Fornecedor vinculado',
    }),
  );
  const marca = catalog.saveReference('MARCA', cmd({ nome: 'Marca fixture 4C' }));
  const categoria = catalog.saveReference('CATEGORIA', cmd({ nome: 'Categoria fixture 4C' }));
  const forma = catalog.saveReference('FORMA_PAGAMENTO', cmd({ nome: 'Pagamento fixture 4C' }));
  const produto = catalog.saveProduct(
    cmd({
      nome: 'Produto fixture 4C',
      sku: 'FIXTURE-4C',
      marcaId: marca.id,
      categoriaId: categoria.id,
      volumeMicrolitros: 1000,
      precoVendaCentavos: 200,
      estoqueMinimo: 0,
    }),
  );
  const clock = () => new Date('2026-11-01T15:00:00Z');
  const commercial = createCommercialService(db, 'fixture-4c', clock);
  const compra = commercial.salvarRascunho(
    cmd({
      tipo: 'COMPRA',
      fornecedorId: fornecedor.id,
      dataComercial: '2026-10-31',
      itens: [{ produtoId: produto.id, quantidade: 10, valorUnitarioCentavos: 100 }],
    }),
  );
  const confirmedCompra = commercial.confirmar(
    cmd({
      id: compra.id,
      versaoEsperada: compra.versao,
      pagamentos: [{ formaPagamentoId: forma.id, valorCentavos: 1000 }],
    }),
  );
  const venda = commercial.salvarRascunho(
    cmd({
      tipo: 'VENDA',
      clienteId: cliente.id,
      modalidadeVenda: 'A_PRAZO',
      dataComercial: '2026-10-31',
      itens: [{ produtoId: produto.id, quantidade: 3, valorUnitarioCentavos: 200 }],
    }),
  );
  const confirmedVenda = commercial.confirmar(
    cmd({
      id: venda.id,
      versaoEsperada: venda.versao,
      pagamentos: [],
      parcelas: [
        { valorCentavos: 300, vencimento: '2026-11-01' },
        { valorCentavos: 300, vencimento: '2026-12-01' },
      ],
    }),
  );
  const financial = createFinancialService(db, 'fixture-4c', clock);
  financial.registrarRecebimento(
    cmd({
      vendaId: venda.id,
      dataEfetiva: '2026-11-01',
      pagamentos: [{ formaPagamentoId: forma.id, valorCentavos: 100 }],
    }),
  );
  assert.equal(confirmedCompra.estado, 'CONFIRMADO');
  assert.equal(confirmedVenda.estado, 'CONFIRMADO');
  assert.equal(confirmedVenda.parcelas.length, 2);
  assert(db.prepare('SELECT count(*) n FROM alocacoes_recebimento').get().n > 0);
  return { cliente, fornecedor, compraId: compra.id, vendaId: venda.id };
}

function snapshotVinculos(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name)
    .filter((name) =>
      /document|parcela|financeir|receb|reembols|estorno|estoque|historico_precos|vinculo/.test(
        name,
      ),
    );
  return {
    tables: Object.fromEntries(
      tables.map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]),
    ),
    operations: db.prepare('SELECT * FROM operacoes ORDER BY id').all(),
    audit: db.prepare('SELECT * FROM eventos_auditoria ORDER BY id').all(),
  };
}
function conferirVinculos(db, before) {
  for (const [name, rows] of Object.entries(before.tables))
    assert.deepEqual(
      db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all(),
      rows,
      `${name} preserved`,
    );
  for (const [name, rows] of [
    ['operacoes', before.operations],
    ['eventos_auditoria', before.audit],
  ])
    for (const row of rows)
      assert.deepEqual(db.prepare(`SELECT * FROM ${name} WHERE id=?`).get(row.id), row);
  checkIntegrity(db);
}
module.exports = { prepararVinculos, snapshotVinculos, conferirVinculos, cmd };
