// Test-only integration audit. No concurrent fixture writes during a checkpoint.
import assert from 'node:assert/strict';
export const money = (value) => {
  if (value === null) return 'Não aplicável';
  const s = String(Math.abs(value)).padStart(3, '0');
  return `${value < 0 ? '−' : ''}R$ ${s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${s.slice(-2)}`;
};
const quantity = (v) => v.toLocaleString('pt-BR');
const percent = (v) =>
  v === null
    ? 'Não aplicável'
    : `${v < 0 ? '−' : ''}${String(Math.abs(v)).padStart(3, '0').slice(0, -2)},${String(Math.abs(v)).padStart(3, '0').slice(-2)}%`;
export async function auditCheckpoint({
  e,
  until,
  generate,
  manifest,
  label,
  filter,
  expected,
  capture,
  saleId,
}) {
  const api = async (method, input) => {
    const result = await e(`window.mnrApi.relatorios.${method}(${JSON.stringify(input)})`);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  };
  const { dataInicio, dataFim } = filter;
  const period = { dataInicio, dataFim };
  const position = filter.clienteId ? { clienteId: filter.clienteId } : {};
  const [
    summary,
    stock,
    sales,
    products,
    clients,
    movements,
    accounts,
    refunds,
    stockRows,
    stockFlow,
    byMethod,
  ] = await Promise.all([
    api('obterResumoGerencial', filter),
    api('obterResumoEstoque', period),
    api('listarVendas', { ...filter, limite: 200 }),
    api('listarProdutos', { ...filter, limite: 200, ordem: 'UNIDADES_DESC' }),
    api('listarClientes', { ...filter, limite: 200 }),
    api('listarMovimentos', { ...filter, limite: 200 }),
    api('listarContasReceber', { ...position, limite: 200 }),
    api('listarReembolsos', { ...position, limite: 200 }),
    api('listarSaldos', { limite: 200 }),
    api('listarMovimentacaoProdutos', { ...period, limite: 200 }),
    api('listarTotaisPorForma', { ...filter, limite: 200 }),
  ]);
  for (const page of [sales, products, clients, movements, accounts, refunds, stockRows])
    assert.equal(page.temMais, false, 'Checkpoint fixture unexpectedly exceeds one audit page');
  if (expected) {
    const financial = await e(`window.mnrApi.financeiro.obterVenda(${saleId})`);
    assert.equal(financial.ok, true);
    assert.equal(financial.data.resumo.valorOriginalCentavos, 30000);
    assert.equal(
      summary.fluxoFinanceiro.recebidoLiquidoCentavos,
      financial.data.resumo.recebidoLiquidoCentavos,
    );
    assert.equal(
      summary.fluxoFinanceiro.reembolsoPagoLiquidoCentavos,
      financial.data.resumo.reembolsoPagoLiquidoCentavos,
    );
    assert.equal(
      summary.coorteVendas.comercialLiquidoAtualCentavos,
      financial.data.resumo.valorComercialLiquidoCentavos,
    );
    assert.equal(
      summary.posicaoAtual.contas.exigivelCentavos,
      financial.data.resumo.saldoReceberCentavos,
    );
    assert.equal(
      summary.posicaoAtual.reembolsos.pendenteCentavos,
      financial.data.resumo.reembolsosPendentesCentavos,
    );
    assert.equal(summary.coorteVendas.comercialLiquidoAtualCentavos, expected.commercial);
    assert.equal(summary.fluxoFinanceiro.recebidoLiquidoCentavos, 25000);
    assert.equal(summary.posicaoAtual.contas.exigivelCentavos, expected.debt);
    assert.equal(summary.posicaoAtual.reembolsos.pendenteCentavos, expected.pending);
    assert.equal(summary.fluxoFinanceiro.reembolsoPagoLiquidoCentavos, expected.paid);
  }
  await e(`location.hash='#/dashboard'`);
  await until('!!document.getElementById("dashboard-preset")');
  const fill = (id, value) =>
    e(
      `(()=>{const x=document.getElementById(${JSON.stringify(id)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event(x.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  await fill('dashboard-preset', 'custom');
  await fill('dashboard-start', dataInicio);
  await fill('dashboard-end', dataFim);
  if (filter.clienteId)
    await until(
      `!!document.querySelector('#dashboard-client option[value="${filter.clienteId}"]')`,
    );
  await fill('dashboard-client', filter.clienteId ? String(filter.clienteId) : '');
  await until('!!document.querySelector("[data-dashboard-ready]")');
  const c = summary.fluxoComercial,
    f = summary.fluxoFinanceiro,
    p = summary.posicaoAtual,
    s = stock.posicaoAtual;
  // Field projection only: no new financial rule or expected total derived from a page.
  const metrics = [
    [
      'revenue',
      c.faturamentoLiquidoCentavos,
      'moeda',
      'fluxoComercial.faturamentoLiquidoCentavos',
      'Fluxo comercial',
    ],
    [
      'sales',
      c.vendasConfirmadas,
      'inteiro',
      'fluxoComercial.vendasConfirmadas',
      'Fluxo comercial',
    ],
    [
      'result',
      c.resultadoBrutoEstimadoCentavos,
      'moeda',
      'fluxoComercial.resultadoBrutoEstimadoCentavos',
      'Fluxo comercial',
    ],
    [
      'margin',
      c.margemBrutaPontosBase,
      'percentual',
      'fluxoComercial.margemBrutaPontosBase',
      'Fluxo comercial',
    ],
    [
      'ticket',
      summary.coorteVendas.ticketMedioCentavos,
      'moeda',
      'coorteVendas.ticketMedioCentavos',
      'Coorte atual',
    ],
    [
      'receipts',
      f.recebidoLiquidoCentavos,
      'moeda',
      'fluxoFinanceiro.recebidoLiquidoCentavos',
      'Fluxo financeiro',
    ],
    [
      'debt',
      p.contas.exigivelCentavos,
      'moeda',
      'posicaoAtual.contas.exigivelCentavos',
      'Posição atual',
    ],
    [
      'overdue',
      p.contas.vencidoCentavos,
      'moeda',
      'posicaoAtual.contas.vencidoCentavos',
      'Posição atual',
    ],
    [
      'refund',
      p.reembolsos.pendenteCentavos,
      'moeda',
      'posicaoAtual.reembolsos.pendenteCentavos',
      'Posição atual',
    ],
    [
      'stock-value',
      s.valorCentavos,
      'moeda',
      'estoque.posicaoAtual.valorCentavos',
      'Posição atual global',
    ],
    ['stock-units', s.unidades, 'inteiro', 'estoque.posicaoAtual.unidades', 'Posição atual global'],
    [
      'stock-empty',
      s.semEstoque,
      'inteiro',
      'estoque.posicaoAtual.semEstoque',
      'Posição atual global',
    ],
    [
      'stock-low',
      s.abaixoMinimo,
      'inteiro',
      'estoque.posicaoAtual.abaixoMinimo',
      'Posição atual global',
    ],
  ];
  const cards = await e(
    `Object.fromEntries(Array.from(document.querySelectorAll('[data-metric]')).map(x=>[x.dataset.metric,x.textContent.trim()]))`,
  );
  const formatted = (v, t) =>
    t === 'moeda' ? money(v) : t === 'percentual' ? percent(v) : quantity(v);
  assert.deepEqual(
    cards,
    Object.fromEntries(metrics.map(([id, v, t]) => [id, formatted(v, t)])),
    label,
  );
  const rankRows = (title) =>
    e(
      `Array.from(document.getElementById(${JSON.stringify(title)}).closest('section').querySelectorAll('tbody tr')).map(tr=>Array.from(tr.children).map(x=>x.textContent.trim()))`,
    );
  const displayedProducts = await rankRows('dashboard-products-title');
  const displayedClients = await rankRows('dashboard-clients-title');
  assert.deepEqual(
    displayedProducts,
    products.itens
      .slice(0, 5)
      .map((v) => [
        v.nomeHistorico + v.skuHistorico,
        quantity(v.unidadesLiquidas),
        money(v.comercialLiquidoCentavos),
      ]),
  );
  assert.deepEqual(
    displayedClients,
    clients.itens
      .slice(0, 5)
      .map((v) => [v.nomeHistorico, quantity(v.vendas), money(v.comercialLiquidoAtualCentavos)]),
  );
  for (const [index, method, field] of [
    [0, 'obterSeriesVendas', 'faturamentoLiquidoCentavos'],
    [1, 'obterSeriesRecebimentos', 'recebidoLiquidoCentavos'],
  ]) {
    const grouping = await e('document.getElementById("dashboard-grouping").value');
    const serie = await api(method, { ...filter, agrupamento: grouping });
    assert.deepEqual(
      await e(
        `Array.from(document.querySelectorAll('mnr-dashboard-chart')[${index}].querySelectorAll('tbody td')).map(x=>x.textContent.trim())`,
      ),
      serie.itens.map((v) => money(v[field])),
    );
  }
  if (capture && ['devolucao', 'rankings-empate'].includes(label)) await capture(label);
  // Exercise the actual link, including the inactive client context, before IPC exports.
  await e(`document.querySelector('mnr-dashboard a[href^="#/relatorios"]').click()`);
  await until('!!document.getElementById("export-start")');
  assert.equal(await e('document.getElementById("export-start").value'), dataInicio);
  assert.equal(await e('document.getElementById("export-end").value'), dataFim);
  assert.equal(
    await e('document.getElementById("export-client").value'),
    filter.clienteId ? String(filter.clienteId) : '',
  );
  const matrix = metrics.map(([id, value, type, source, temporal]) => ({
    indicador: id,
    fonte: source,
    oficial: value,
    tipo: type,
    dashboard: cards[id],
    temporal,
    xlsx: null,
    pdf: null,
  }));
  const details = {};
  for (const model of [
    'GERENCIAL',
    'VENDAS',
    'MOVIMENTOS',
    'CONTAS',
    'REEMBOLSOS',
    'ESTOQUE',
    'DESEMPENHO',
  ]) {
    const modelFilter =
      model === 'ESTOQUE' ? {} : ['CONTAS', 'REEMBOLSOS'].includes(model) ? position : filter;
    for (const format of ['xlsx', 'pdf']) {
      await generate(model, format, `4f4-${label}`, modelFilter);
      const file = manifest.at(-1),
        sections = file.documento.secoes;
      const rows = (name) => sections.find((s) => s.nome === name).linhas;
      const totals = rows('Resumo').map((r) => r[1].valor);
      if (model === 'GERENCIAL') {
        assert.deepEqual(
          totals,
          metrics.map((m) => m[1]),
        );
        matrix.forEach(
          (row, i) =>
            (row[format] = {
              arquivo: file.path,
              aba: 'Resumo',
              indicador: rows('Resumo')[i][0],
              valor: totals[i],
            }),
        );
      }
      if (model === 'VENDAS') {
        assert.deepEqual(totals, Object.values(sales.totais));
        assert.deepEqual(
          rows('Vendas'),
          sales.itens.map((v) => [
            v.numero,
            v.dataComercial,
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.estado,
            v.originalCentavos,
            v.comercialLiquidoAtualCentavos,
            v.custoHistoricoLiquidoAtualCentavos,
          ]),
        );
      }
      if (model === 'MOVIMENTOS') {
        assert.deepEqual(totals, Object.values(movements.totais));
        assert.deepEqual(
          rows('Movimentos'),
          movements.itens.map((v) => [
            v.id,
            v.dataEfetiva,
            v.vendaNumero,
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.natureza,
            v.formaHistorica,
            v.valorCentavos,
            v.estornaMovimentoId,
          ]),
        );
      }
      if (model === 'CONTAS') {
        assert.deepEqual(totals, Object.values(accounts.totais));
        assert.deepEqual(
          rows('Contas a receber'),
          accounts.itens.map((v) => [
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.vendaNumero,
            v.id,
            v.tipo,
            v.vencimento,
            v.originalCentavos,
            v.recebimentosLiquidosCentavos,
            v.abatimentosLiquidosCentavos,
            v.saldoCentavos,
            v.status,
          ]),
        );
      }
      if (model === 'REEMBOLSOS') {
        assert.deepEqual(totals, Object.values(refunds.totais));
        for (const [i, v] of refunds.itens.entries()) {
          const detail = await e(
            `window.mnrApi.financeiro.obterReembolso({vendaId:${v.vendaId},reembolsoId:${v.id}})`,
          );
          assert.equal(detail.ok, true);
          assert.deepEqual(rows('Reembolsos')[i], [
            v.id,
            v.vendaId,
            v.correcaoId,
            v.clienteNomeHistorico ?? 'Sem identificação',
            v.ativa ? (v.pendenteCentavos ? 'PENDENTE' : 'PAGA') : 'ANULADA',
            v.originalCentavos,
            detail.data.pagosCentavos,
            detail.data.estornosCentavos,
            v.pagoLiquidoCentavos,
            v.pendenteCentavos,
          ]);
        }
      }
      if (model === 'ESTOQUE') {
        assert.deepEqual(totals, Object.values(stockRows.totais));
        assert.deepEqual(
          rows('Estoque'),
          stockRows.itens.map((v) => [
            v.produtoId,
            v.skuAtual,
            v.nomeAtual,
            v.ativo ? 'Ativo' : 'Inativo',
            v.quantidade,
            v.valorCentavos,
            v.estoqueMinimo,
            v.quantidade === 0 ? 'Sim' : 'Não',
            v.quantidade < v.estoqueMinimo ? 'Sim' : 'Não',
          ]),
        );
      }
      if (model === 'DESEMPENHO') {
        assert.deepEqual(
          rows('Produtos'),
          products.itens.map((v, i) => [
            i + 1,
            v.produtoId,
            v.skuHistorico,
            v.nomeHistorico,
            v.unidadesLiquidas,
            v.comercialLiquidoCentavos,
          ]),
        );
        assert.deepEqual(
          rows('Clientes'),
          clients.itens.map((v, i) => [
            i + 1,
            v.clienteId,
            v.nomeHistorico,
            v.vendas,
            v.comercialLiquidoAtualCentavos,
          ]),
        );
        assert.deepEqual(totals, [
          ...Object.values(products.totais),
          ...Object.values(clients.totais),
        ]);
      }
      details[`${model}.${format}`] = { arquivo: file.path, registros: file.documento.registros };
    }
  }
  console.log('CONSOLIDACAO_GERENCIAL_CHECKPOINT_OK', label, matrix.length);
  return {
    label,
    filter,
    matrix,
    summary,
    stock,
    stockFlow,
    byMethod,
    details,
    rankings: {
      products: products.itens,
      clients: clients.itens,
      displayedProducts,
      displayedClients,
    },
  };
}

export async function auditFilteredExports({ e, generate, manifest, range, ids }) {
  const results = [];
  for (const [model, method, filters, section, idKey, column] of [
    [
      'VENDAS',
      'listarVendas',
      { ...range, clienteId: ids.clienteId, produtoId: ids.productId, ordem: 'VALOR_DESC' },
      'Vendas',
      'numero',
      0,
    ],
    [
      'MOVIMENTOS',
      'listarMovimentos',
      {
        ...range,
        clienteId: ids.clienteId,
        formaPagamentoId: ids.pix,
        natureza: 'RECEBIMENTO',
        ordem: 'VALOR_DESC',
      },
      'Movimentos',
      'id',
      0,
    ],
    [
      'CONTAS',
      'listarContasReceber',
      {
        clienteId: ids.clienteId,
        situacao: 'ABERTAS',
        vencimentoDe: '2026-12-01',
        vencimentoAte: '2027-01-01',
      },
      'Contas a receber',
      'id',
      2,
    ],
    [
      'REEMBOLSOS',
      'listarReembolsos',
      { clienteId: ids.clienteId, situacao: 'ANULADAS' },
      'Reembolsos',
      'id',
      0,
    ],
    [
      'ESTOQUE',
      'listarSaldos',
      { ativo: false, situacao: 'BAIXO', ordem: 'QUANTIDADE_DESC' },
      'Estoque',
      'produtoId',
      0,
    ],
  ]) {
    const official = await e(
      `window.mnrApi.relatorios.${method}(${JSON.stringify({ ...filters, limite: 200 })})`,
    );
    assert.equal(official.ok, true);
    assert.equal(official.data.temMais, false);
    const files = [];
    for (const format of ['xlsx', 'pdf']) {
      await generate(model, format, '4f4-filtro', filters);
      const file = manifest.at(-1),
        sections = file.documento.secoes;
      const values = sections.find((s) => s.nome === section).linhas;
      assert.deepEqual(
        values.map((v) => v[column]),
        official.data.itens.map((v) => v[idKey]),
      );
      assert.deepEqual(
        sections.find((s) => s.nome === 'Resumo').linhas.map((v) => v[1].valor),
        Object.values(official.data.totais),
      );
      files.push(file.path);
    }
    results.push({
      model,
      filters,
      totais: official.data.totais,
      ids: official.data.itens.map((v) => v[idKey]),
      files,
    });
  }
  console.log('CONSOLIDACAO_GERENCIAL_FILTERS_OK', results.length);
  return { label: 'filtros', results };
}
