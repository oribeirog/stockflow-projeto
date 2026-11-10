const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { transpileModule, ModuleKind } = require('typescript');
const { runInNewContext } = require('node:vm');
const exportsObject = {};
runInNewContext(
  transpileModule(readFileSync('src/app/features/dashboard/presentation.ts', 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText,
  { exports: exportsObject, Date },
);
const { validPeriod, presetPeriod, percentLabel, dateLabel } = exportsObject;
test('Dashboard validates real inclusive calendar dates and 366-day boundary', () => {
  const valid = (a, b) => validPeriod({ dataInicio: a, dataFim: b });
  assert.equal(valid('2024-01-01', '2024-12-31'), true);
  assert.equal(valid('2024-01-01', '2025-01-01'), false);
  assert.equal(valid('2026-02-29', '2026-03-01'), false);
  assert.equal(valid('2024-02-29', '2024-02-29'), true);
  assert.equal(valid('2026-03-01', '2026-02-28'), false);
  assert.equal(valid('', '2026-02-28'), false);
  assert.equal(valid('2026-1-01', '2026-02-28'), false);
  assert.equal(valid('0000-01-01', '0000-01-01'), true);
  assert.equal(valid('9999-12-31', '9999-12-31'), true);
});
test('Dashboard presets use local calendar with inclusive 30/90-day intervals', () => {
  const now = new Date(2026, 0, 1, 23, 55);
  for (const [preset, from] of [
    ['month', '2026-01-01'],
    ['30', '2025-12-03'],
    ['90', '2025-10-04'],
  ]) {
    const p = presetPeriod(preset, now);
    assert.equal(p.dataInicio, from);
    assert.equal(p.dataFim, '2026-01-01');
  }
});
test('Dashboard formats official basis points and calendar strings without KPI arithmetic', () => {
  assert.equal(percentLabel(null), 'Não aplicável');
  assert.equal(percentLabel(0), '0,00%');
  assert.equal(percentLabel(-1234), '−12,34%');
  assert.equal(percentLabel(1), '0,01%');
  assert.equal(dateLabel('2026-01-01'), '01/01/2026');
  assert.equal(dateLabel('2026-12'), '12/2026');
});
