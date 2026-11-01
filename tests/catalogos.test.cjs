const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { checkIntegrity } = require('../dist/electron/infrastructure/database/migrate.js');
const { createCatalogService } = require('../dist/electron/services/catalogos.js');
const { MAX_MONEY } = require('../dist/electron/services/catalog-validation.js');
const command = (dados, extra = {}) => ({
  operacaoId: randomUUID(),
  motivo: 'Teste de cadastro',
  dados,
  ...extra,
});
const code = (expected) => (error) => error.code === expected;
async function fixture(t) {
  const root = resolve('.local-data');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'catalogos-test-'));
  const db = await openDatabase(directory, 'test');
  t.after(() => {
    checkIntegrity(db);
    db.close();
  });
  const service = createCatalogService(db, 'test');
  const marca = service.saveReference('MARCA', command({ nome: 'Marca' }));
  const categoria = service.saveReference('CATEGORIA', command({ nome: 'Categoria' }));
  const product = (overrides = {}) => ({
    nome: 'Perfume',
    sku: ' sku-01 ',
    marcaId: marca.id,
    categoriaId: categoria.id,
    volumeMicrolitros: 100000,
    precoVendaCentavos: 10001,
    estoqueMinimo: 0,
    ...overrides,
  });
  return { db, service, marca, categoria, product, directory };
}
test('reference catalogs normalize uniqueness, search, update and inactivate without deletion', async (t) => {
  const { service, db } = await fixture(t);
  for (const kind of ['MARCA', 'CATEGORIA', 'FORMA_PAGAMENTO']) {
    const saved = service.saveReference(kind, command({ nome: '  Água  de  Flor  ' }));
    assert.equal(saved.nome, 'Água  de  Flor');
    assert.equal(saved.ativo, true);
    assert.throws(
      () => service.saveReference(kind, command({ nome: 'agua de flor' })),
      code('CONFLICT'),
    );
    assert.equal(service.listReferences(kind, { busca: 'ÁGUA DE' })[0].id, saved.id);
    assert.equal(
      service.saveReference(kind, command({ id: saved.id, nome: 'Água de Flor', ativo: false }))
        .ativo,
      false,
    );
    assert.equal(service.listReferences(kind, { busca: 'agua de', ativo: true }).length, 0);
    assert.equal(service.getReference(kind, saved.id).ativo, false);
  }
  assert.throws(() => db.exec('DELETE FROM marcas'), /exclusao proibida/);
  assert.throws(() => service.getReference('MARCA', 999), code('NOT_FOUND'));
  assert.throws(() => service.listReferences('sqlite_schema'), code('VALIDATION'));
});
test('people accept optional data, duplicate names, CPF, numeric CNPJ and official alpha CNPJ example', async (t) => {
  const { service } = await fixture(t);
  for (const kind of ['CLIENTE', 'FORNECEDOR']) {
    const blank = service.savePerson(kind, command({ nome: 'Pessoa', documento: ' ', email: '' }));
    assert.equal(blank.documento, null);
    assert.equal(blank.email, null);
    service.savePerson(kind, command({ nome: 'Pessoa' }));
    const cpf = service.savePerson(
      kind,
      command({ nome: 'CPF', tipoPessoa: 'PF', documento: '529.982.247-25' }),
    );
    assert.equal(cpf.documento, '52998224725');
    assert.throws(
      () =>
        service.savePerson(
          kind,
          command({ nome: 'Outro', tipoPessoa: 'PF', documento: '52998224725' }),
        ),
      code('CONFLICT'),
    );
    const cnpj = service.savePerson(
      kind,
      command({ nome: 'CNPJ', tipoPessoa: 'PJ', documento: '11.222.333/0001-81' }),
    );
    assert.equal(cnpj.documento, '11222333000181');
    // Official Receita Federal example: manual-dv-cnpj.pdf.
    const alpha = service.savePerson(
      kind,
      command({ nome: 'Alfanumérico', tipoPessoa: 'PJ', documento: '12.abc.345/01de-35' }),
    );
    assert.equal(alpha.documento, '12ABC34501DE35');
    const changed = service.savePerson(
      kind,
      command({
        id: alpha.id,
        nome: '  Óleos  ',
        ativo: false,
        tipoPessoa: 'PJ',
        documento: alpha.documento,
        telefone: '11999999999',
        email: 'contato@example.com',
        endereco: 'Rua',
        observacoes: 'Obs',
      }),
    );
    assert.equal(changed.ativo, false);
    assert.equal(service.listPeople(kind, { busca: 'oleos' })[0].id, alpha.id);
  }
});
test('invalid documents, unknown fields, enums, decimals, overflow and unsafe IDs cause no writes', async (t) => {
  const { service, db, product } = await fixture(t);
  const count = () => db.prepare('SELECT count(*) n FROM operacoes').get().n;
  const before = count();
  for (const data of [
    { nome: '' },
    { nome: 'A', tipoPessoa: 'PF', documento: '11111111111' },
    { nome: 'A', tipoPessoa: 'PF', documento: '52998224724' },
    { nome: 'A', tipoPessoa: 'PJ', documento: '12ABC34501DE34' },
    { nome: 'A', tipoPessoa: 'PF', documento: '52998224725<script>' },
    { nome: 'A', tipoPessoa: 'X' },
    { nome: 'A', documento: '52998224725' },
    { nome: 'A', email: 'bad' },
    { nome: 'A', inesperado: true },
  ])
    assert.throws(() => service.savePerson('CLIENTE', command(data)), code('VALIDATION'));
  for (const overrides of [
    { precoVendaCentavos: 1.1 },
    { precoVendaCentavos: MAX_MONEY + 1 },
    { precoVendaCentavos: -1 },
    { precoVendaCentavos: '100' },
    { precoVendaCentavos: Infinity },
    { estoqueMinimo: 1_000_000_001 },
    { volumeMicrolitros: 0 },
    { ativo: 1 },
    { marcaId: Number.MAX_SAFE_INTEGER + 1 },
    { sku: ' ' },
    { nome: 'x'.repeat(201) },
  ])
    assert.throws(() => service.saveProduct(command(product(overrides))), code('VALIDATION'));
  assert.throws(
    () => service.saveReference('MARCA', command({ nome: 'x' }, { extra: true })),
    code('VALIDATION'),
  );
  assert.throws(() => service.listProducts({ limite: 201 }), code('VALIDATION'));
  assert.throws(
    () => service.listPeople('CLIENTE', { busca: '%', sql: 'DROP TABLE' }),
    code('VALIDATION'),
  );
  assert.equal(count(), before);
});
test('products preserve exact prices, unique inactive SKU/barcode, FK and append-only price history', async (t) => {
  const { service, db, product } = await fixture(t);
  const original = service.saveProduct(command(product({ codigoBarras: '   ' })));
  assert.equal(original.sku, 'SKU-01');
  assert.equal(original.codigoBarras, null);
  assert.equal(original.precoVendaCentavos, 10001);
  assert.equal(service.listProducts({ busca: 'sku-01' })[0].id, original.id);
  assert.throws(() => service.saveProduct(command(product())), code('CONFLICT'));
  assert.throws(
    () => service.saveProduct(command(product({ sku: 'missing', marcaId: 999 }))),
    code('NOT_FOUND'),
  );
  let changed = service.saveProduct(
    command(
      product({
        id: original.id,
        precoVendaCentavos: MAX_MONEY,
        codigoBarras: '123',
        ativo: false,
      }),
    ),
  );
  assert.equal(changed.precoVendaCentavos, MAX_MONEY);
  assert.equal(changed.ativo, false);
  assert.deepEqual(
    service
      .priceHistory(original.id)
      .map((row) => [row.precoAnteriorCentavos, row.precoNovoCentavos]),
    [
      [null, 10001],
      [10001, MAX_MONEY],
    ],
  );
  changed = service.saveProduct(
    command(product({ id: original.id, precoVendaCentavos: MAX_MONEY, codigoBarras: '123' })),
  );
  assert.equal(changed.ativo, false);
  assert.equal(service.priceHistory(original.id).length, 2);
  assert.throws(
    () => service.saveProduct(command(product({ sku: 'other', codigoBarras: '123' }))),
    code('CONFLICT'),
  );
  assert.throws(
    () => service.saveProduct(command(product({ id: original.id, sku: 'changed' }))),
    code('VALIDATION'),
  );
  assert.throws(() => service.saveProduct(command(product())), code('CONFLICT'));
  assert.throws(() => db.exec('UPDATE historico_precos SET preco_novo_centavos=0'), /imutavel/);
  assert.throws(() => db.exec('DELETE FROM historico_precos'), /imutavel/);
  assert.throws(() => db.exec('DELETE FROM produtos'), /exclusao proibida/);
});
test('inactive classifications reject new associations but permit editing existing products', async (t) => {
  const { service, product, marca } = await fixture(t);
  const saved = service.saveProduct(command(product()));
  service.saveReference('MARCA', command({ id: marca.id, nome: marca.nome, ativo: false }));
  assert.throws(
    () => service.saveProduct(command(product({ sku: 'new' }))),
    code('INACTIVE_REFERENCE'),
  );
  assert.equal(
    service.saveProduct(command(product({ id: saved.id, nome: 'Editado' }))).nome,
    'Editado',
  );
});
test('idempotency rejects different payloads and audit retains before/after without duplicate history', async (t) => {
  const { service, db, product } = await fixture(t);
  const request = command(product());
  const saved = service.saveProduct(request);
  const reordered = {
    motivo: request.motivo,
    dados: { ...request.dados, nome: ' Perfume ' },
    operacaoId: request.operacaoId,
  };
  assert.deepEqual(service.saveProduct(reordered), saved);
  assert.equal(service.priceHistory(saved.id).length, 1);
  assert.throws(
    () => service.saveProduct({ ...request, dados: product({ precoVendaCentavos: 999 }) }),
    code('IDEMPOTENCY_CONFLICT'),
  );
  assert.throws(
    () => service.saveReference('MARCA', { ...request, dados: { nome: 'Other' } }),
    code('IDEMPOTENCY_CONFLICT'),
  );
  const changed = service.saveProduct(
    command(product({ id: saved.id, precoVendaCentavos: 10002 })),
  );
  const events = db
    .prepare('SELECT * FROM eventos_auditoria WHERE produto_id = ? ORDER BY id')
    .all(saved.id);
  assert.equal(events.length, 2);
  assert.equal(events[0].antes_json, null);
  assert.deepEqual(JSON.parse(events[1].antes_json), saved);
  assert.deepEqual(JSON.parse(events[1].depois_json), changed);
  assert.equal(events[1].versao_aplicativo, 'test');
  assert.throws(() => db.exec("UPDATE eventos_auditoria SET motivo='other'"), /imutavel/);
  assert.throws(() => db.exec('DELETE FROM eventos_auditoria'), /imutavel/);
  assert.throws(
    () =>
      db
        .prepare('UPDATE operacoes SET resultado_json = ? WHERE id = ?')
        .run('{}', request.operacaoId),
    /finalizada/,
  );
});
test('injected failures after product/history/audit writes roll back all effects and allow retry', async (t) => {
  const { service, db, product } = await fixture(t);
  for (const point of ['historico_precos', 'eventos_auditoria', 'operacoes']) {
    const request = command(product({ sku: point }));
    db.exec(
      point === 'operacoes'
        ? "CREATE TRIGGER injected_failure BEFORE UPDATE ON operacoes BEGIN SELECT RAISE(ABORT,'injected'); END"
        : `CREATE TRIGGER injected_failure AFTER INSERT ON ${point} BEGIN SELECT RAISE(ABORT,'injected'); END`,
    );
    assert.throws(() => service.saveProduct(request));
    assert.equal(
      db.prepare('SELECT count(*) n FROM produtos WHERE sku = ?').get(point.toUpperCase()).n,
      0,
    );
    for (const table of ['operacoes', 'historico_precos', 'eventos_auditoria']) {
      assert.equal(
        db
          .prepare(
            `SELECT count(*) n FROM ${table} WHERE ${table === 'operacoes' ? 'id' : 'operacao_id'} = ?`,
          )
          .get(request.operacaoId).n,
        0,
      );
    }
    db.exec('DROP TRIGGER injected_failure');
    assert.equal(service.saveProduct(request).sku, point.toUpperCase());
  }
});
test('queries use literal search, stable pagination and persisted data survives reopening', async (t) => {
  const { service, directory } = await fixture(t);
  service.savePerson('CLIENTE', command({ nome: 'Álvaro' }));
  service.savePerson('CLIENTE', command({ nome: 'Álvaro' }));
  service.savePerson('CLIENTE', command({ nome: 'Cliente %' }));
  assert.equal(service.listPeople('CLIENTE', { busca: '%' }).length, 1);
  const first = service.listPeople('CLIENTE', { busca: 'alvaro', limite: 1 });
  const next = service.listPeople('CLIENTE', { busca: 'alvaro', limite: 1, deslocamento: 1 });
  assert.notEqual(first[0].id, next[0].id);
  const reopened = await openDatabase(directory, 'test');
  try {
    assert.deepEqual(
      createCatalogService(reopened, 'test').getPerson('CLIENTE', first[0].id),
      first[0],
    );
  } finally {
    reopened.close();
  }
});
