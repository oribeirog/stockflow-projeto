const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
module.exports = async ({ evaluate, ids, advance, reopen, capture, key, faults }) => {
  const until = async (expression) => {
    for (let i = 0; i < 300; i++) {
      if (await evaluate(expression)) return;
      await pause(30);
    }
    throw Error(
      'Dashboard timeout: ' +
        expression +
        '\n' +
        (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const fill = async (id, value) => {
    await evaluate(
      `(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  };
  const button = async (label) => {
    await until(
      `Array.from(document.querySelectorAll('mnr-dashboard button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('mnr-dashboard button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  };
  const ready = () => until('!!document.querySelector("[data-dashboard-ready]")');
  const period = async (start = '2026-11-01', end = '2026-11-30') => {
    await fill('dashboard-preset', 'custom');
    await fill('dashboard-start', start);
    await fill('dashboard-end', end);
    await button('Aplicar filtros');
  };
  const check = async () => {
    await ready();
    const filter = await evaluate(
      `({dataInicio:document.getElementById('dashboard-start').value,dataFim:document.getElementById('dashboard-end').value,...(document.getElementById('dashboard-client').value?{clienteId:Number(document.getElementById('dashboard-client').value)}:{})})`,
    );
    const official = await evaluate(
      `window.mnrApi.relatorios.obterResumoGerencial(${JSON.stringify(filter)})`,
    );
    assert.equal(official.ok, true);
    const g = official.data;
    const money = (n) => {
      const raw = String(Math.abs(n)).padStart(3, '0');
      return `${n < 0 ? '−' : ''}R$ ${raw.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${raw.slice(-2)}`;
    };
    const margin = (v) =>
      v === null
        ? 'Não aplicável'
        : `${v < 0 ? '−' : ''}${String(Math.abs(v)).padStart(3, '0').slice(0, -2)},${String(Math.abs(v)).padStart(3, '0').slice(-2)}%`;
    const expected = {
      revenue: money(g.fluxoComercial.faturamentoLiquidoCentavos),
      sales: g.fluxoComercial.vendasConfirmadas.toLocaleString('pt-BR'),
      result: money(g.fluxoComercial.resultadoBrutoEstimadoCentavos),
      margin: margin(g.fluxoComercial.margemBrutaPontosBase),
      ticket:
        g.coorteVendas.ticketMedioCentavos === null
          ? 'Não aplicável'
          : money(g.coorteVendas.ticketMedioCentavos),
      receipts: money(g.fluxoFinanceiro.recebidoLiquidoCentavos),
      debt: money(g.posicaoAtual.contas.exigivelCentavos),
      overdue: money(g.posicaoAtual.contas.vencidoCentavos),
      refund: money(g.posicaoAtual.reembolsos.pendenteCentavos),
    };
    const stock = await evaluate(
      `window.mnrApi.relatorios.obterResumoEstoque(${JSON.stringify({ dataInicio: filter.dataInicio, dataFim: filter.dataFim })})`,
    );
    assert.equal(stock.ok, true);
    const p = stock.data.posicaoAtual;
    Object.assign(expected, {
      'stock-value': money(p.valorCentavos),
      'stock-units': p.unidades.toLocaleString('pt-BR'),
      'stock-empty': p.semEstoque.toLocaleString('pt-BR'),
      'stock-low': p.abaixoMinimo.toLocaleString('pt-BR'),
    });
    assert.deepEqual(
      await evaluate(
        `Object.fromEntries(Array.from(document.querySelectorAll('[data-metric]')).map(e=>[e.dataset.metric,e.textContent.trim()]))`,
      ),
      expected,
    );
    const grouping = await evaluate('document.getElementById("dashboard-grouping").value');
    for (const [title, method, extra, cells] of [
      [
        'dashboard-products-title',
        'listarProdutos',
        { ordem: 'UNIDADES_DESC' },
        (x) => [
          `${x.nomeHistorico}${x.skuHistorico}`,
          x.unidadesLiquidas.toLocaleString('pt-BR'),
          money(x.comercialLiquidoCentavos),
        ],
      ],
      [
        'dashboard-clients-title',
        'listarClientes',
        {},
        (x) => [
          x.nomeHistorico,
          x.vendas.toLocaleString('pt-BR'),
          money(x.comercialLiquidoAtualCentavos),
        ],
      ],
    ]) {
      const ranking = await evaluate(
        `window.mnrApi.relatorios.${method}(${JSON.stringify({ ...filter, ...extra, limite: 5 })})`,
      );
      assert.equal(ranking.ok, true);
      assert.deepEqual(
        await evaluate(
          `Array.from(document.getElementById(${JSON.stringify(title)}).closest('section').querySelectorAll('tbody tr')).map(tr=>Array.from(tr.children).map(e=>e.textContent.trim()))`,
        ),
        ranking.data.itens.map(cells),
      );
    }
    for (const [index, method, field] of [
      [0, 'obterSeriesVendas', 'faturamentoLiquidoCentavos'],
      [1, 'obterSeriesRecebimentos', 'recebidoLiquidoCentavos'],
    ]) {
      const r = await evaluate(
        `window.mnrApi.relatorios.${method}(${JSON.stringify({ ...filter, agrupamento: grouping })})`,
      );
      assert.equal(r.ok, true);
      assert.deepEqual(
        await evaluate(
          `Array.from(document.querySelectorAll('mnr-dashboard-chart')[${index}].querySelectorAll('tbody td')).map(e=>e.textContent.trim())`,
        ),
        r.data.itens.map((x) => money(x[field])),
      );
      const geometry = await evaluate(
        `document.querySelectorAll('mnr-dashboard-chart polyline')[${index}].getAttribute('points')`,
      );
      assert.ok(!/NaN|Infinity/.test(geometry));
    }
    console.log(
      'DASHBOARD_VALUES_OK',
      filter,
      g.fluxoComercial.faturamentoLiquidoCentavos,
      g.fluxoFinanceiro.recebidoLiquidoCentavos,
    );
    return g;
  };
  assert.equal(await evaluate('typeof require'), 'undefined');
  assert.equal(await evaluate('typeof process'), 'undefined');
  await until('!!document.getElementById("dashboard-preset")');
  await ready();
  const defaultDates = await evaluate(
    `({from:document.getElementById('dashboard-start').value,to:document.getElementById('dashboard-end').value,local:new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0')})`,
  );
  assert.equal(defaultDates.from, defaultDates.local.slice(0, 7) + '-01');
  assert.equal(defaultDates.to, defaultDates.local);
  await period();
  await check();
  if (!reopen) {
    await capture('empty');
    for (const stage of [
      'entry',
      'receipt',
      'return',
      'payment',
      'undo-payment',
      'undo-return',
      'undo-receipt',
      'modalities',
      'inactive',
    ]) {
      advance(stage);
      await button('Atualizar');
      const g = await check();
      if (stage === 'entry') {
        assert.equal(g.fluxoComercial.faturamentoLiquidoCentavos, 30000);
        assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, 10000);
      }
      if (stage === 'return') {
        assert.equal(g.fluxoComercial.faturamentoLiquidoCentavos, 10000);
        assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, 25000);
        assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, 15000);
        await capture('reference');
        await period('2026-11-02', '2026-11-02');
        const negative = await check();
        assert.equal(negative.fluxoComercial.faturamentoLiquidoCentavos, -20000);
        assert.equal(negative.coorteVendas.ticketMedioCentavos, null);
        assert.equal(negative.fluxoComercial.margemBrutaPontosBase, null);
        await evaluate(
          `document.querySelector('mnr-dashboard-chart').scrollIntoView({block:'start'})`,
        );
        await capture('negative');
        await period();
        await check();
      }
      if (stage === 'payment') assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, 5000);
      if (stage === 'undo-payment') assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, 15000);
      if (stage === 'undo-return') assert.equal(g.posicaoAtual.reembolsos.pendenteCentavos, 0);
      if (stage === 'undo-receipt') assert.equal(g.fluxoFinanceiro.recebidoLiquidoCentavos, 10000);
    }
    assert.ok(
      (await evaluate('document.querySelector("mnr-dashboard").innerText')).includes(
        'Perfume ciclo histórico',
      ),
    );
    assert.ok(
      (await evaluate('document.querySelector("mnr-dashboard").innerText')).includes(
        'Cliente ciclo histórico',
      ),
    );
    await fill('dashboard-search', 'Cliente atual inativo');
    await until(
      'document.querySelector("#dashboard-client").textContent.includes("Cliente atual inativo")',
    );
    await fill('dashboard-client', String(ids.clienteId));
    await check();
    assert.equal(
      await evaluate(`document.querySelector('[data-metric="stock-low"]').textContent.trim()`),
      '1',
    );
    await fill('dashboard-client', '');
    await ready();
    await fill('dashboard-grouping', 'MENSAL');
    await check();
    await fill('dashboard-grouping', 'DIARIO');
    await check();
    for (const preset of ['30', '90', 'month']) {
      await fill('dashboard-preset', preset);
      await check();
    }
    await period('2024-01-01', '2024-12-31');
    await check();
    await period('2024-01-01', '2025-01-01');
    await until('!!document.querySelector("#dashboard-filter-error[role=alert]")');
    assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 0);
    for (const [from, to] of [
      ['2026-12-01', '2026-11-01'],
      ['', '2026-11-01'],
    ]) {
      await period(from, to);
      await until('!!document.querySelector("#dashboard-filter-error[role=alert]")');
    }
    await capture('invalid');
    await period();
    await ready();
    if (faults) {
      faults.set({ fail: true });
      await button('Atualizar');
      await until(
        'document.querySelector("mnr-dashboard mnr-content-state .error")?.textContent.includes("Falha ao consultar Dashboard")',
      );
      assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 0);
      await capture('error');
      faults.set({});
      await button('Tentar novamente');
      await check();
      faults.set({ from: '2025-01-01', delay: 1600 });
      await period('2025-01-01', '2025-01-03');
      for (let i = 0; i < 100 && !faults.entered(); i++) await pause(20);
      assert.equal(faults.entered(), true);
      await capture('loading');
      faults.set({});
      await period();
      await check();
      for (let i = 0; i < 150 && !faults.finished(); i++) await pause(20);
      assert.equal(faults.finished(), true);
      await pause(100);
      await check();
      console.log('DASHBOARD_OUT_OF_ORDER_AND_RECOVERY_OK');
    }
    await evaluate(`document.querySelector('main').scrollTop=0`);
    await capture('overview', true);
    for (const [name, selector] of [
      ['commercial', '#dashboard-commercial-title'],
      ['series', '#dashboard-series-title'],
      ['rankings', '#dashboard-products-title'],
      ['stock', '#dashboard-stock-title'],
    ]) {
      await evaluate(
        `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`,
      );
      await capture(name, true);
    }
    await evaluate(
      `document.querySelector('mnr-dashboard-chart details').open=true;document.querySelector('mnr-dashboard-chart details').scrollIntoView({block:'start'})`,
    );
    await capture('table');
    await evaluate(`document.getElementById('dashboard-grouping').focus()`);
    await key('Tab');
    assert.equal(await evaluate('document.activeElement.id'), 'dashboard-search');
    await key('Tab', 8);
    assert.equal(await evaluate('document.activeElement.id'), 'dashboard-grouping');
    assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
    await key('Escape');
    await evaluate(`document.querySelector('mnr-dashboard-chart summary').focus()`);
    await key('Enter');
    assert.equal(
      await evaluate(`document.querySelector('mnr-dashboard-chart details').open`),
      false,
    );
    // Actual Dashboard links to existing destinations and return with a fresh query.
    for (const path of [
      '/vendas',
      '/financeiro/parcelas',
      '/financeiro/reembolsos',
      '/estoque',
      '/clientes',
    ]) {
      await evaluate(`document.querySelector('mnr-dashboard a[href="#${path}"]').click()`);
      await until(
        `location.hash===${JSON.stringify('#' + path)} && !document.querySelector('mnr-dashboard')`,
      );
      await evaluate(`document.querySelector('nav a[href="#/dashboard"]').click()`);
      await ready();
    }
    await period();
    await check();
  }
  console.log('DASHBOARD_SCENARIO_OK', reopen ? 'reopen' : 'first');
};
