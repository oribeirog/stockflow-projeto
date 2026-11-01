const { mkdirSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../../dist/electron/infrastructure/database/index.js');
const { createCatalogService } = require('../../dist/electron/services/catalogos.js');
const { createStockService } = require('../../dist/electron/services/estoque.js');
const day = '2026-10-31';
const command = (dados, extra = {}) => ({
  operacaoId: randomUUID(),
  motivo: 'Ajuste físico de teste',
  dataEfetiva: day,
  dados,
  ...extra,
});
const cadastro = (dados) => ({ operacaoId: randomUUID(), motivo: 'Cadastro de teste', dados });
async function fixture(t) {
  const root = resolve('.local-data/test');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'estoque-'));
  const db = await openDatabase(directory, 'test');
  if (t)
    t.after(() => {
      if (db.open) db.close();
    });
  const catalog = createCatalogService(db, 'test');
  const brand = catalog.saveReference('MARCA', cadastro({ nome: 'Marca' }));
  const category = catalog.saveReference('CATEGORIA', cadastro({ nome: 'Categoria' }));
  const productData = {
    nome: 'Perfume',
    sku: 'TEST',
    marcaId: brand.id,
    categoriaId: category.id,
    volumeMicrolitros: 1000,
    precoVendaCentavos: 100,
    estoqueMinimo: 0,
  };
  const product = catalog.saveProduct(cadastro(productData));
  const service = createStockService(db, 'test', () => new Date('2026-11-01T15:00:00Z'));
  return { db, directory, product, productData, catalog, service, command };
}
module.exports = { fixture, command, cadastro };
