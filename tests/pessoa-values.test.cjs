const { test } = require('node:test');
const assert = require('node:assert/strict');
const { documentoCanonico } = require('../dist/shared/pessoa-values.js');
const { documentNumber } = require('../dist/electron/services/catalog-validation.js');

test('shared document rules preserve CPF and numeric/alphanumeric CNPJ boundary behavior', () => {
  for (const [raw, type, expected] of [
    [null, null, null],
    [null, 'PF', null],
    [null, 'PJ', null],
    ['529.982.247-25', 'PF', '52998224725'],
    ['11.222.333/0001-81', 'PJ', '11222333000181'],
    ['12.abc.345/01de-35', 'PJ', '12ABC34501DE35'],
  ]) {
    assert.equal(documentoCanonico(raw, type), expected);
    assert.equal(documentNumber(raw, type), expected);
  }
  for (const [raw, type] of [
    ['52998224725', null],
    ['11111111111', 'PF'],
    ['52998224724', 'PF'],
    ['12ABC34501DE34', 'PJ'],
    ['52998224725<script>', 'PF'],
    ['52998224725', 'PJ'],
    ['11222333000181', 'PF'],
  ]) {
    assert.throws(() => documentoCanonico(raw, type));
    assert.throws(
      () => documentNumber(raw, type),
      (e) => e.code === 'VALIDATION',
    );
  }
  assert.equal(documentNumber('  ', null), null);
  assert.throws(() => documentNumber('x'.repeat(41), 'PJ'), /documento/);
});
