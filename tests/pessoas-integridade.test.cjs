const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/estoque-fixture.cjs');
const {
  prepararVinculos,
  snapshotVinculos,
  conferirVinculos,
  cmd,
} = require('../scripts/pessoas-fixture.cjs');

test('person edits and activation preserve confirmed purchases, sales, installments, payments and all original audit/operations', async (t) => {
  const { db, catalog } = await fixture(t);
  const linked = prepararVinculos(db);
  const before = snapshotVinculos(db);
  for (const [kind, person] of [
    ['CLIENTE', linked.cliente],
    ['FORNECEDOR', linked.fornecedor],
  ]) {
    const { criadoEm, atualizadoEm, ...data } = person;
    assert(criadoEm && atualizadoEm);
    for (const active of [false, true]) {
      const command = cmd({ ...data, nome: `${person.nome} editado`, ativo: active });
      const saved = catalog.savePerson(kind, command);
      assert.equal(saved.ativo, active);
      assert.equal(saved.id, person.id);
      for (const key of ['tipoPessoa', 'documento', 'telefone', 'email', 'endereco', 'observacoes'])
        assert.equal(saved[key], person[key]);
      const auditCount = db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n;
      assert.deepEqual(catalog.savePerson(kind, command), saved);
      assert.equal(db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n, auditCount);
      conferirVinculos(db, before);
    }
  }
  assert.equal(
    db.prepare('SELECT cliente_id FROM documentos WHERE id=?').get(linked.vendaId).cliente_id,
    linked.cliente.id,
  );
  assert.equal(
    db.prepare('SELECT fornecedor_id FROM documentos WHERE id=?').get(linked.compraId)
      .fornecedor_id,
    linked.fornecedor.id,
  );
});
