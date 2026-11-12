const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarExportador } = require('../dist/electron/ipc/exportacoes');
test('4F3 dialog cancellation, busy guard and invalid commands never generate or write', async () => {
  let generated = 0,
    saved = 0,
    release;
  const exporter = criarExportador({
    escolher: () => new Promise((r) => (release = r)),
    gerar: async () => {
      generated++;
      throw Error('unexpected');
    },
    salvar: async () => {
      saved++;
      return 'unexpected';
    },
    pdf: async () => {
      throw Error('unexpected');
    },
  });
  const pending = exporter('xlsx', { modelo: 'ESTOQUE', filtros: {} });
  const busy = await exporter('pdf', { modelo: 'ESTOQUE', filtros: {} });
  assert.equal(busy.error.code, 'EXPORT_BUSY');
  release(undefined);
  assert.deepEqual(await pending, { ok: true, data: { cancelado: true } });
  for (const args of [
    [],
    [{}, {}],
    [{ modelo: 'SQL', filtros: {} }],
    [{ modelo: 'ESTOQUE', filtros: { destino: 'C:/private' } }],
  ])
    assert.equal((await exporter('xlsx', ...args)).error.code, 'VALIDATION');
  assert.equal(generated, 0);
  assert.equal(saved, 0);
});
test('4F3 generation and permission failures are sanitized and release the busy lock', async () => {
  let failing = true,
    writes = 0;
  const exporter = criarExportador({
    escolher: async () => 'C:/test-only/report.xlsx',
    gerar: async () => {
      if (failing) throw Error('SQL private path password');
      return {
        bytes: new Uint8Array([1]),
        documento: { geradoEm: '2026-11-01T00:00:00Z', registros: 1 },
      };
    },
    salvar: async () => {
      writes++;
      throw Object.assign(Error('private path'), { code: 'EACCES' });
    },
    pdf: async () => new Uint8Array([1]),
  });
  const first = await exporter('xlsx', { modelo: 'ESTOQUE', filtros: {} });
  assert.equal(first.error.code, 'EXPORT_FAILED');
  assert(!JSON.stringify(first).includes('private'));
  assert.equal(writes, 0);
  failing = false;
  const second = await exporter('xlsx', { modelo: 'ESTOQUE', filtros: {} });
  assert.equal(second.error.code, 'EACCES');
  assert(!JSON.stringify(second).includes('private'));
  assert.equal(writes, 1);
});
