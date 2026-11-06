const assert = require('node:assert/strict'),
  { setTimeout: pause } = require('node:timers/promises');
module.exports = async ({ evaluate, ids, capture, keyboard, faults }) => {
  const until = async (e) => {
    for (let n = 0; n < 250; n++) {
      if (await evaluate(e)) return;
      await pause(30);
    }
    throw Error(
      'Timeout ' + e + '\n' + (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const text = () => evaluate('document.querySelector("main")?.innerText');
  const button = async (label) => {
    const e = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled&&!b.closest('fieldset:disabled'))`;
    await until(`!!(${e})`);
    await evaluate(`${e}.click()`);
    await pause(60);
  };
  const fill = async (id, value) => {
    await until(`!!document.getElementById(${JSON.stringify(id)})`);
    await evaluate(
      `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(40);
  };
  const api = async (e) => {
    const r = await evaluate('window.mnrApi.' + e);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const navigate = async (path) => {
    await evaluate(`location.hash=${JSON.stringify('#/' + path)}`);
    await until(
      `!!document.querySelector('main')&&!document.querySelector('main')?.innerText.includes('Consultando dados oficiais…')`,
    );
    await pause(140);
  };
  const payPath = (c) => `financeiro/reembolsos/${c.reembolsoId}/pagar?vendaId=${c.saleId}`;
  const defaults = async () => {
    await fill('operacao-data', '2026-11-01');
    await fill('operacao-motivo', 'Operação solicitada pelo proprietário');
  };
  const payment = async (amount = '100') => {
    await fill('operacao-forma-0', String(ids.pix));
    await fill('operacao-valor-0', amount);
  };
  const review = async () => {
    await button('Revisar operação');
    await until(`!!document.getElementById('operacao-revisao')`);
  };
  const confirm = async () => {
    await button('Confirmar operação revisada');
    await until(`!!document.querySelector('dialog[open]')`);
    assert.equal(await evaluate('document.activeElement.id'), 'confirm-title');
    await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar');b.click();b.click();})()`,
    );
    await pause(80);
  };
  const complete = async () => {
    await confirm();
    await until(
      `!!document.querySelector('[aria-label="Operação concluída"]')&&!document.querySelector('mnr-operacao-financeira > section > mnr-button button:disabled')`,
    );
  };
  const refund = (c) =>
    api(`financeiro.obterReembolso({vendaId:${c.saleId},reembolsoId:${c.reembolsoId}})`);
  const estornar = async (c, id) => {
    await navigate(`financeiro/vendas/${c.saleId}/movimentos/${id}`);
    await until(`!!document.querySelector('a[href$="/estornar"]')`);
    await evaluate(`document.querySelector('a[href$="/estornar"]').click()`);
    await until(`!!document.getElementById('operacao-data')`);
    await defaults();
    await review();
  };
  await until(`!!window.mnrApi?.financeiro&&!!document.querySelector('nav')`);
  assert.equal(await evaluate('typeof require'), 'undefined');
  for (const m of ['estornarAjuste', 'devolverCompra', 'cancelarCompra'])
    assert.equal(await evaluate(`typeof window.mnrApi.correcoes.${m}`), 'undefined');
  await navigate(`financeiro/reembolsos/${ids.main.reembolsoId}?vendaId=${ids.main.saleId}`);
  await until(`!!document.querySelector('a[href*="/pagar"]')`);
  await evaluate(`document.querySelector('a[href*="/pagar"]').click()`);
  await until(`!!document.getElementById('operacao-data')`);
  await defaults();
  await payment('0');
  await button('Revisar operação');
  assert.equal(
    await evaluate(`document.getElementById('operacao-valor-0').getAttribute('aria-invalid')`),
    'true',
  );
  await payment('151');
  await button('Revisar operação');
  await until(`document.querySelector('main')?.innerText.includes('Confira data')`);
  await payment();
  await review();
  assert.match(await text(), /50,00/);
  await capture?.('pagamento');
  await keyboard?.();
  await fill('operacao-motivo', 'Pagamento parcial de reembolso');
  assert.equal(await evaluate(`!!document.getElementById('operacao-revisao')`), false);
  await review();
  await complete();
  let r = await refund(ids.main);
  assert.equal(r.pagoLiquidoCentavos, 10000);
  assert.equal(r.saldoExigivelCentavos, 5000);
  await capture?.('resultado');
  let movements = await api(
    `financeiro.listarMovimentos({vendaId:${ids.main.saleId},reembolsoId:${ids.main.reembolsoId}})`,
  );
  const first = movements.itens.find((m) => m.natureza === 'REEMBOLSO_CLIENTE');
  await estornar(ids.main, first.id);
  await capture?.('estorno');
  await complete();
  r = await refund(ids.main);
  assert.equal(r.pagoLiquidoCentavos, 0);
  assert.equal(r.saldoExigivelCentavos, 15000);
  await navigate(payPath(ids.main));
  await defaults();
  await payment('90');
  await button('Adicionar forma');
  await fill('operacao-forma-1', String(ids.cash));
  await fill('operacao-valor-1', '60');
  await review();
  await complete();
  assert.equal((await refund(ids.main)).saldoExigivelCentavos, 0);
  movements = await api(
    `financeiro.listarMovimentos({vendaId:${ids.main.saleId},reembolsoId:${ids.main.reembolsoId}})`,
  );
  const active = movements.itens.filter(
    (m) => m.natureza === 'REEMBOLSO_CLIENTE' && !m.estornadoPorId,
  );
  assert.equal(active.length, 2);
  await navigate(`vendas/correcoes/${ids.main.correcaoId}?vendaId=${ids.main.saleId}`);
  await until(`document.querySelector('main')?.innerText.includes('Estorne individualmente')`);
  assert.equal(
    await evaluate(`!!document.querySelector('a[href*="/correcoes/"][href*="/estornar"]')`),
    false,
  );
  await navigate(`vendas/correcoes/${ids.main.correcaoId}/estornar?vendaId=${ids.main.saleId}`);
  await until(`!!document.getElementById('operacao-data')`);
  assert.equal(await evaluate(`document.querySelector('#operacao-revisar button').disabled`), true);
  await estornar(ids.main, active[0].id);
  await complete();
  assert.equal((await refund(ids.main)).saldoExigivelCentavos, active[0].valorCentavos);
  const other = await api(
    `financeiro.obterMovimento({vendaId:${ids.main.saleId},movimentoId:${active[1].id}})`,
  );
  assert.equal(other.estornadoPorId, null);
  await estornar(ids.main, active[1].id);
  await complete();
  assert.equal((await refund(ids.main)).saldoExigivelCentavos, 15000);
  const stock = await api(`estoque.obter(${ids.main.productId})`);
  await navigate(`vendas/correcoes/${ids.main.correcaoId}?vendaId=${ids.main.saleId}`);
  await until(`!!document.querySelector('a[href*="/correcoes/"][href*="/estornar"]')`);
  await evaluate(`document.querySelector('a[href*="/correcoes/"][href*="/estornar"]').click()`);
  await until(`!!document.getElementById('operacao-data')`);
  await defaults();
  await review();
  await capture?.('devolucao');
  await complete();
  const after = await api(`estoque.obter(${ids.main.productId})`);
  assert.equal(after.quantidade, stock.quantidade - 1);
  assert.equal(after.valorTotalCentavos, stock.valorTotalCentavos - 100);
  const sale = await api(`financeiro.obterVenda(${ids.main.saleId})`);
  assert.equal(sale.resumo.valorComercialLiquidoCentavos, 30000);
  assert.equal(sale.resumo.saldoReceberCentavos, 5000);
  assert.equal(sale.resumo.reembolsosPendentesCentavos, 0);
  assert.equal((await refund(ids.main)).ativa, false);
  await navigate(`financeiro/reembolsos/${ids.main.reembolsoId}?vendaId=${ids.main.saleId}`);
  await until(`document.querySelector('main')?.innerText.includes('Anulada')`);
  assert.equal(await evaluate(`!!document.querySelector('a[href*="/pagar"]')`), false);
  await navigate(`financeiro/vendas/${ids.main.saleId}/movimentos/${ids.main.recebimentos[0]}`);
  await until(`!!document.querySelector('a[href$="/estornar"]')`); // now eligible only after the correction was reversed
  await navigate(`financeiro/vendas/${ids.other.saleId}/movimentos/${ids.other.recebimentos[0]}`);
  await until(
    `document.querySelector('main')?.innerText.includes('Recebimento sustenta correção')`,
  );
  assert.equal(await evaluate(`!!document.querySelector('a[href$="/estornar"]')`), false);
  await estornar(ids.receipt, ids.receipt.recebimentos[0]);
  assert.match(await text(), /Pix recebido histórico/);
  await complete();
  const receipt = await api(`financeiro.obterVenda(${ids.receipt.saleId})`);
  assert.equal(receipt.resumo.saldoReceberCentavos, 16000);
  const untouched = await api(
    `financeiro.obterMovimento({vendaId:${ids.receipt.saleId},movimentoId:${ids.receipt.recebimentos[1]}})`,
  );
  assert.equal(untouched.estornadoPorId, null);
  await navigate(
    `vendas/correcoes/${ids.blocked.correcaoId}/estornar?vendaId=${ids.blocked.saleId}`,
  );
  await until(`document.querySelector('main')?.innerText.includes('movimentações posteriores')`);
  assert.equal(await evaluate(`document.querySelector('#operacao-revisar button').disabled`), true);
  if (faults) {
    await navigate(payPath(ids.other));
    await defaults();
    await payment('20');
    await review();
    await faults.concurrent();
    await confirm();
    await until(`document.querySelector('main')?.innerText.includes('mudou')`);
    assert.equal(await evaluate(`document.getElementById('operacao-valor-0').value`), '20');
    await button('Consultar dados atuais');
    await review();
    await faults.rollback(true);
    await confirm();
    await until(
      `!!document.getElementById('operacao-feedback')&&!document.getElementById('operacao-revisao')`,
    );
    await faults.rollback(false);
    await review();
    await faults.loseReply();
    await confirm();
    await until(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Repetir mesma intenção')`,
    );
    const hash = await evaluate('location.hash');
    await evaluate(
      `document.querySelector('a[href="#/financeiro/vendas/${ids.other.saleId}"]').click()`,
    );
    await pause(100);
    assert.equal(await evaluate('location.hash'), hash);
    await button('Repetir mesma intenção');
    await until(`!!document.querySelector('[aria-label="Operação concluída"]')`);
    await faults.checkReplay();
    await button('Registrar outro pagamento');
    await defaults();
    await payment('10');
    await review();
    await faults.readFailure();
    await complete();
    await until(`document.querySelector('main')?.innerText.includes('Falhou somente')`);
    await button('Consultar dados atuais');
    await faults.checkRead();
  }
  await navigate(payPath(ids.other));
  if (await evaluate(`!!document.querySelector('[aria-label="Operação concluída"]')`))
    await button('Registrar outro pagamento');
  await defaults();
  await evaluate(
    `document.querySelector('a[href="#/financeiro/vendas/${ids.other.saleId}"]').click()`,
  );
  await until(`!!document.querySelector('dialog[open]')`);
  await button('Voltar');
  await evaluate(
    `document.querySelector('a[href="#/financeiro/vendas/${ids.other.saleId}"]').click()`,
  );
  await until(`!!document.querySelector('dialog[open]')`);
  await button('Confirmar');
  await until(`!document.querySelector('dialog[open]')`);
  console.log('REEMBOLSOS_SCENARIO_OK');
};
