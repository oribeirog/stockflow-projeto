const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
module.exports = async function scenario({ evaluate, ids, capture, keyboard, reload }) {
  const until = async (expr) => {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(expr)) return;
      await pause(30);
    }
    throw Error(
      'Timeout: ' + expr + '\n' + (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const text = () => evaluate(`document.querySelector('main').innerText`);
  const button = async (label) => {
    const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(`!!(${expr})`);
    await evaluate(`${expr}.click()`);
    await pause(60);
  };
  const fill = async (id, value) => {
    await until(`!!document.getElementById(${JSON.stringify(id)})`);
    await evaluate(
      `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(60);
  };
  const navigate = async (path) => {
    await evaluate(`location.hash=${JSON.stringify('#/' + path)}`);
    await pause(100);
  };
  const api = async (expression) => {
    const r = await evaluate(expression);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  await until(`!!window.mnrApi?.financeiro && !!document.querySelector('nav')`);
  assert.equal(await evaluate('typeof require'), 'undefined');
  assert.equal(await evaluate('typeof process'), 'undefined');
  assert.deepEqual(
    await evaluate('Object.keys(window.mnrApi.financeiro).sort()'),
    [
      'listarMovimentos',
      'listarParcelas',
      'listarReembolsos',
      'obterMovimento',
      'obterParcela',
      'obterReembolso',
      'obterVenda',
      'revisarRecebimento',
      'registrarRecebimento',
    ].sort(),
  );
  assert.deepEqual(
    await evaluate('Object.keys(window.mnrApi.correcoes).sort()'),
    ['obterContextoVenda', 'listarDocumentos', 'obterDocumento'].sort(),
  );
  await evaluate(`document.querySelector('#main-navigation a[href="#/financeiro"]').click()`);
  await until(`!!document.querySelector('#financeiro-resultados')`);
  assert.equal(await evaluate('location.hash'), '#/financeiro/parcelas');
  assert.equal(await evaluate(`document.querySelectorAll('tbody tr').length`), 25);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('main input,main select')).every(e=>e.labels.length>0)`,
    ),
    true,
  );
  const first = await api('window.mnrApi.financeiro.listarParcelas({})');
  assert.ok(first.temMais);
  await button('Próxima');
  await until(`document.getElementById('financeiro-resultados')===document.activeElement`);
  const second = await api('window.mnrApi.financeiro.listarParcelas({deslocamento:25})');
  assert.equal(
    await evaluate(`document.querySelector('tbody a').getAttribute('href')`),
    '#/financeiro/parcelas/' + second.itens[0].id,
  );
  await fill('financeiro-cliente-busca', 'Cliente atual');
  await fill('financeiro-cliente', String(ids.client));
  assert.equal(
    await evaluate(`document.getElementById('financeiro-cliente').value`),
    String(ids.client),
  );
  await fill('financeiro-venda', String(ids.overdue));
  await fill('financeiro-situacao', 'PARCIALMENTE_PAGO');
  await until(`document.querySelector('tbody')?.innerText.includes('parcialmente paga')`);
  assert.match(await text(), /VENCIDO.*parcialmente paga/);
  assert.match(await text(), /Cliente histórico financeiro.*inativo/);
  await capture?.('parcelas');
  await keyboard?.();
  const p = await api(
    `window.mnrApi.financeiro.listarParcelas({vendaId:${ids.overdue},situacao:'PARCIALMENTE_PAGO'})`,
  );
  await evaluate(
    `document.querySelector('a[href="#/financeiro/parcelas/${p.itens[0].id}"]').click()`,
  );
  await until(
    `document.querySelector('mnr-financeiro-detalhe')?.innerText.includes('Recebido líquido alocado')`,
  );
  assert.match(await text(), /Data local de referência/);
  await navigate('financeiro/vendas/' + ids.integrated);
  await until(`!!document.querySelector('[data-financial="reembolsosPendentesCentavos"] dd')`);
  const summary = await api(`window.mnrApi.financeiro.obterVenda(${ids.integrated})`);
  for (const [field, value] of Object.entries(summary.resumo)) {
    if (field === 'vendaId') continue;
    const visible = await evaluate(
      `document.querySelector('[data-financial="${field}"] dd')?.textContent`,
    );
    assert.ok(visible, `Campo financeiro ausente: ${field}`);
    assert.equal(
      visible.replace(/\s/g, ''),
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
        .format(value / 100)
        .replace(/\s/g, ''),
      field,
    );
  }
  await until(
    `document.querySelector('[aria-label="Histórico de movimentos"]').innerText.includes('Pix histórico financeiro')`,
  );
  assert.match(await text(), /DEVOLUCAO_VENDA/);
  await capture?.('resumo');
  await navigate(`financeiro/vendas/${ids.integrated}/movimentos/${ids.refundPayment}`);
  await until(`document.querySelector('main').innerText.includes('Estornado pelo movimento')`);
  assert.match(await text(), /Pix histórico financeiro/);
  assert.match(await text(), /Alocações históricas/);
  await evaluate(
    `document.querySelector('a[href="#/financeiro/vendas/${ids.integrated}/movimentos/${ids.refundReversal}"]').click()`,
  );
  await until(`document.querySelector('main').innerText.includes('Movimento original')`);
  await navigate(`financeiro/reembolsos/${ids.active}?vendaId=${ids.integrated}`);
  await until(
    `document.querySelector('main').innerText.includes('Recebimentos que originaram a obrigação')`,
  );
  assert.match((await text()).replace(/\s/g, ''), /PendenteexigívelatualR\$150,00/);
  await capture?.('reembolso');
  await evaluate(
    `document.querySelector('a[href="#/vendas/correcoes/${ids.correction}?vendaId=${ids.integrated}"]').click()`,
  );
  await until(`document.querySelector('main').innerText.includes('PERDA_DEVOLUCAO')`);
  assert.match(await text(), /Perfume histórico financeiro/);
  assert.doesNotMatch(await text(), /Perfume atual inativo/);
  await capture?.('correcao');
  await navigate('financeiro/reembolsos');
  await until(`!!document.querySelector('#financeiro-situacao')`);
  // Dynamic options must visibly match the model's initial filter.
  assert.equal(await evaluate(`document.getElementById('financeiro-situacao').value`), 'ATIVAS');
  await fill('financeiro-situacao', 'ANULADAS');
  await until(`document.querySelector('tbody').innerText.includes('Anulada')`);
  await navigate(`financeiro/reembolsos/${ids.annulled}?vendaId=${ids.annulledSale}`);
  await until(`document.querySelector('main').innerText.includes('Anulada por estorno')`);
  assert.match((await text()).replace(/\s/g, ''), /PendenteexigívelatualR\$0,00/);
  await navigate(`vendas/correcoes/${ids.annulledReturn}?vendaId=${ids.annulledSale}`);
  await until(`document.querySelector('main').innerText.includes('Estorno vinculado')`);
  await navigate('financeiro/vendas/' + ids.cancelledSale);
  await until(`!!document.querySelector('[data-financial="reembolsosPendentesCentavos"]')`);
  assert.match(await text(), /ESTORNADO/);
  await navigate('financeiro/parcelas');
  await until(`!!document.querySelector('#financeiro-venda')`);
  await fill('financeiro-venda', '999999');
  await button('Consultar financeiro');
  await until(`document.querySelector('main').innerText.includes('Nenhuma parcela')`);
  await fill('financeiro-de', '2026-02-30');
  await button('Consultar financeiro');
  await until(`!!document.querySelector('.feedback')`);
  assert.equal(await evaluate(`document.activeElement.className`), 'feedback');
  await fill('financeiro-de', '');
  await fill('financeiro-venda', '');
  await button('Consultar financeiro');
  await until(`document.querySelectorAll('tbody tr').length===25`);
  await navigate('financeiro/vendas/' + ids.integrated);
  await until(`!!document.querySelector('[data-financial="valorOriginalCentavos"]')`);
  await reload?.();
  await until(`!!document.querySelector('[data-financial="valorOriginalCentavos"]')`);
  assert.equal(
    await evaluate(`document.querySelectorAll('mnr-confirm,input,select,textarea').length`),
    0,
  );
  console.log('FINANCEIRO_SCENARIO_OK');
};
