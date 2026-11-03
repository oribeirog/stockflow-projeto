const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decimalInteger: parse, decimalText: format } = require('../dist/shared/perfume-values.js');
test('perfume money and volumes convert exactly without rounding or losing microlitres', () => {
  assert.equal(parse('129,90', 2, 0, 9e12), 12990);
  assert.equal(parse('0.01', 2, 0, 9e12), 1);
  assert.equal(parse('100,125', 3, 1, 1e9), 100125);
  assert.equal(parse('0,001', 3, 1, 1e9), 1);
  assert.equal(parse('90000000000,00', 2, 0, 9e12), 9e12);
  for (const raw of ['', '-1', '1e2', '1.234,56', '1,234.56', '0,001', '90000000000,01'])
    assert.equal(parse(raw, 2, 0, 9e12), null, raw);
  assert.equal(parse('0', 3, 1, 1e9), null);
  for (const value of [1, 10, 100125, 999999999, 1e9])
    assert.equal(parse(format(value, 3), 3, 1, 1e9), value);
});
