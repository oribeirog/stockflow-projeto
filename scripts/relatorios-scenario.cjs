const assert = require('node:assert/strict');
module.exports = async ({ evaluate, ids }) => {
  assert.equal(await evaluate('typeof require'), 'undefined');
  assert.equal(await evaluate('typeof process'), 'undefined');
  const range = { dataInicio: '2026-10-01', dataFim: '2026-12-31' };
  const inputs = {
    obterResumoGerencial: range,
    obterSeriesVendas: { ...range, agrupamento: 'DIARIO' },
    obterSeriesRecebimentos: { ...range, agrupamento: 'MENSAL' },
    listarVendas: range,
    listarProdutos: range,
    listarClientes: range,
    listarMovimentos: range,
    listarTotaisPorForma: range,
    listarMovimentacaoProdutos: range,
    listarContasReceber: {},
    listarReembolsos: {},
    obterResumoEstoque: range,
    listarSaldos: {},
  };
  const api = async (method, input) => {
    const r = await evaluate(`window.mnrApi.relatorios.${method}(${JSON.stringify(input)})`);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  assert.deepEqual(
    await evaluate('Object.keys(window.mnrApi.relatorios).sort()'),
    Object.keys(inputs).sort(),
  );
  const results = {};
  for (const [method, input] of Object.entries(inputs)) {
    results[method] = await api(method, input);
    assert.equal(typeof results[method].consultadoEm, 'string');
    const invalid = await evaluate(
      `window.mnrApi.relatorios.${method}(${JSON.stringify({ ...input, sql: 'SELECT secret' })})`,
    );
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'VALIDATION');
  }
  const g = results.obterResumoGerencial;
  assert.equal(g.fluxoComercial.faturamentoLiquidoCentavos, 10000);
  assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, 25000);
  assert.equal(g.posicaoAtual.contas.exigivelCentavos, 0);
  assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, 15000);
  assert.equal(g.fluxoComercial.cmvHistoricoLiquidoCentavos, 100);
  assert.equal(g.fluxoComercial.perdasImpropriosLiquidasCentavos, 100);
  const official = await evaluate(`window.mnrApi.financeiro.obterVenda(${ids.saleId})`);
  assert.equal(official.ok, true);
  assert.equal(
    g.coorteVendas.comercialLiquidoAtualCentavos,
    official.data.resumo.valorComercialLiquidoCentavos,
  );
  assert.equal(results.listarVendas.totais.comercialLiquidoAtualCentavos, 10000);
  assert.equal(results.obterResumoEstoque.posicaoAtual.unidades, 23);
  assert.equal(results.obterResumoEstoque.posicaoAtual.valorCentavos, 51800);
  assert.equal(results.listarProdutos.itens[0].nomeHistorico, 'Perfume ciclo histórico');
  const byForm = results.listarTotaisPorForma;
  assert.equal(
    byForm.itens.reduce((n, x) => n + x.recebidoLiquidoCentavos, 0),
    25000,
  );
  const empty = await api('obterSeriesVendas', {
    dataInicio: '2025-12-31',
    dataFim: '2026-01-01',
    agrupamento: 'DIARIO',
  });
  assert.deepEqual(
    empty.itens.map((x) => x.faturamentoLiquidoCentavos),
    [0, 0],
  );
  console.log('RELATORIOS_TYPED_READONLY_OK');
};
