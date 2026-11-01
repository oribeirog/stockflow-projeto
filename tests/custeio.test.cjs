const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { custoSaida, stockNumber, MAX_STOCK_MONEY } = require('../dist/electron/domain/custeio.js');

test('BigInt cost preserves half-up cents, exact depletion and large intermediates', () => {
  assert.equal(custoSaida(100n, 3n, 1n), 33n);
  assert.equal(custoSaida(67n, 2n, 1n), 34n);
  assert.equal(custoSaida(33n, 1n, 1n), 33n);
  assert.equal(custoSaida(1n, 2n, 1n), 1n);
  assert.equal(custoSaida(0n, 100n, 40n), 0n);
  assert.equal(custoSaida(MAX_STOCK_MONEY, 1000000000n, 999999999n), 8999999991000n);
  for (const args of [
    [-1n, 1n, 1n],
    [1n, 0n, 1n],
    [1n, 1n, 2n],
    [1n, 1n, 0n],
  ])
    assert.throws(() => custoSaida(...args), RangeError);
  assert.throws(() => stockNumber(9007199254740992n, 10000000000000000n), RangeError);
});

test('SQLite integer decomposition agrees with BigInt including bounds and ties', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('trusted_schema=OFF');
    const expression = `:q * (:v / :total) + ((:v % :total) * :q) / :total +
      CASE WHEN (((:v % :total) * :q) % :total) >= (:total / 2 + :total % 2) THEN 1 ELSE 0 END`;
    const query = db
      .prepare(`SELECT ${expression} cost, typeof(${expression}) type`)
      .safeIntegers();
    const cases = [
      [100n, 3n, 1n],
      [67n, 2n, 1n],
      [1n, 2n, 1n],
      [0n, 1n, 1n],
      [9000000000000n, 1000000000n, 999999999n],
      [8999999999999n, 1000000000n, 999999999n],
    ];
    let seed = 19n;
    const next = () => (seed = (seed * 48271n) % 2147483647n);
    for (let i = 0; i < 10000; i++) {
      const total = 1n + (next() % 1000000000n);
      cases.push([(next() * 4001n) % 9000000000001n, total, 1n + (next() % total)]);
    }
    for (const [v, total, q] of cases) {
      const row = query.get({ v, total, q });
      assert.equal(row.type, 'integer');
      assert.equal(row.cost, custoSaida(v, total, q));
      // Independent rounding characterization: error in [-1/2, 1/2), ties upwards.
      const twiceError = 2n * (row.cost * total - v * q);
      assert.ok(twiceError > -total && twiceError <= total);
    }
    db.function('unsafe_probe', { deterministic: true }, (value) => value);
    db.exec(
      'CREATE TABLE probe(x INTEGER) STRICT; CREATE TRIGGER probe_check BEFORE INSERT ON probe BEGIN SELECT unsafe_probe(NEW.x); END',
    );
    assert.throws(() => db.exec('INSERT INTO probe VALUES(1)'), /unsafe use/);
  } finally {
    db.close();
  }
});
