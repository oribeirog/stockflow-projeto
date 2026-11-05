const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
module.exports = async ({ evaluate, ids, capture, keyboard, faults }) => {
  const until = async (expr) => {
    for (let n = 0; n < 250; n++) {
      if (await evaluate(expr)) return;
      await pause(30);
    }
    throw Error(
      'Timeout ' + expr + '\n' + (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const button = async (label) => {
    const e = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(`!!(${e})`);
    await evaluate(`${e}.click()`);
    await pause(60);
  };
  const fill = async (id, value) => {
    await evaluate(
      `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await pause(40);
  };
  const api = async (expr) => {
    const r = await evaluate('window.mnrApi.' + expr);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const navigate = async (sale, cancel = false) => {
    if (
      !cancel &&
      (await evaluate(
        `location.hash==='#/vendas/${sale.id}/devolver'&&!!document.querySelector('[aria-label="Correção concluída"]')`,
      ))
    ) {
      await button('Registrar outra devolução');
      return;
    }
    await evaluate(`location.hash='#/vendas/${sale.id}/${cancel ? 'cancelar' : 'devolver'}'`);
    await until(
      `!!document.getElementById('correcao-data')&&!document.getElementById('correcao-data').disabled`,
    );
    await pause(80);
  };
  const defaults = async () => {
    await fill('correcao-data', '2026-11-01');
    await fill('correcao-motivo', 'Correção solicitada pelo cliente');
  };
  const select = async (sale, q, loss = '0') => {
    const id = sale.itens[0].id;
    await evaluate(`document.getElementById('correcao-s-${id}').click()`);
    await fill('correcao-q-' + id, q);
    await fill('correcao-p-' + id, loss);
  };
  const review = async () => {
    await button('Revisar efeitos oficiais');
    await until(`!!document.getElementById('correcao-revisao')`);
  };
  const confirm = async () => {
    await button('Confirmar correção revisada');
    await until(`!!document.querySelector('dialog[open]')`);
    assert.equal(await evaluate(`document.activeElement.id==='confirm-title'`), true);
    await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar');b.click();b.click();})()`,
    );
    await pause(80);
  };
  const complete = async () => {
    await confirm();
    await until(
      `!!document.querySelector('[aria-label="Correção concluída"]')&&!document.querySelector('mnr-correcao-venda > section > mnr-button button:disabled')`,
    );
  };
  const text = () => evaluate('document.querySelector("main")?.innerText');
  await until(`!!window.mnrApi?.correcoes&&!!document.querySelector('nav')`);
  assert.equal(await evaluate('typeof require'), 'undefined');
  for (const method of ['estornarDevolucao', 'devolverCompra', 'cancelarCompra', 'estornarAjuste'])
    assert.equal(await evaluate(`typeof window.mnrApi.correcoes.${method}`), 'undefined');
  await evaluate(`location.hash='#/vendas/${ids.main.id}'`);
  await until(`!!document.querySelector('a[href="#/vendas/${ids.main.id}/devolver"]')`);
  await evaluate(`document.querySelector('a[href="#/vendas/${ids.main.id}/devolver"]').click()`);
  await until(`!!document.getElementById('correcao-data')`);
  await pause(120);
  assert.match(await text(), /Perfume recebimentos/);
  assert.doesNotMatch(await text(), /Nome atual inativo/);
  assert.match(await text(), /Cliente histórico recebimentos/);
  const before = await api(`estoque.obter(${ids.productId})`);
  await defaults();
  await button('Revisar efeitos oficiais');
  assert.equal(await evaluate(`document.activeElement.id`), 'correcao-selecao');
  assert.equal(
    await evaluate(`document.getElementById('correcao-selecao').getAttribute('aria-describedby')`),
    'correcao-itens-erro',
  );
  await select(ids.main, '4');
  await button('Revisar efeitos oficiais');
  assert.equal(
    await evaluate(
      `document.getElementById('correcao-q-${ids.main.itens[0].id}').getAttribute('aria-invalid')`,
    ),
    'true',
  );
  await fill('correcao-q-' + ids.main.itens[0].id, '1');
  await fill('correcao-p-' + ids.main.itens[0].id, '2');
  await button('Revisar efeitos oficiais');
  assert.equal(
    await evaluate(
      `document.getElementById('correcao-p-${ids.main.itens[0].id}').getAttribute('aria-invalid')`,
    ),
    'true',
  );
  await fill('correcao-p-' + ids.main.itens[0].id, '1');
  await capture?.('formulario');
  await review();
  await capture?.('revisao');
  await keyboard?.();
  // Editing invalidates the official review.
  await fill('correcao-motivo', 'Correção com unidade imprópria');
  assert.equal(await evaluate(`!!document.getElementById('correcao-revisao')`), false);
  await review();
  await complete();
  const after = await api(`estoque.obter(${ids.productId})`);
  assert.equal(after.quantidade, before.quantidade);
  assert.equal(after.valorTotalCentavos, before.valorTotalCentavos);
  await capture?.('resultado');
  const docs = await api(`correcoes.listarDocumentos({vendaId:${ids.main.id}})`);
  assert.equal(docs.itens.length, 1);
  await evaluate(`document.querySelector('a[href*="/vendas/correcoes/"]').click()`);
  await until(`document.querySelector('main')?.innerText.includes('PERDA_DEVOLUCAO')`);
  await navigate(ids.main);
  await defaults();
  await button('Selecionar todos os itens restantes');
  await review();
  await complete();
  const final = await api(`estoque.obter(${ids.productId})`);
  assert.equal(final.quantidade, before.quantidade + 2);
  assert.equal(final.valorTotalCentavos, before.valorTotalCentavos + 20);
  await evaluate(`location.hash='#/vendas/${ids.main.id}/cancelar'`);
  await until(
    `document.querySelector('main')?.innerText.includes('Venda indisponível para esta operação')`,
  );
  assert.equal(await evaluate(`document.querySelector('#correcao-revisar button').disabled`), true);
  await navigate(ids.other, true);
  await defaults();
  await review();
  await capture?.('cancelamento');
  await complete();
  const cancelled = await api(`financeiro.obterVenda(${ids.other.id})`);
  assert.equal(cancelled.vendaEstado, 'ESTORNADO');
  await navigate(ids.entry);
  await defaults();
  await select(ids.entry, '2', '1');
  await review();
  assert.match(await text(), /150,00/);
  await complete();
  const financial = await api(`financeiro.obterVenda(${ids.entry.id})`);
  assert.equal(financial.resumo.valorComercialLiquidoCentavos, 10000);
  assert.equal(financial.resumo.recebimentosEfetivosCentavos, 25000);
  assert.equal(financial.resumo.saldoReceberCentavos, 0);
  assert.equal(financial.resumo.reembolsosPendentesCentavos, 15000);
  const refunds = await api(`financeiro.listarReembolsos({vendaId:${ids.entry.id}})`);
  assert.equal(refunds.itens[0].saldoExigivelCentavos, 15000);
  await evaluate(
    `location.hash='#/financeiro/reembolsos/${refunds.itens[0].id}?vendaId=${ids.entry.id}'`,
  );
  await until(`document.querySelector('main')?.innerText.includes('Obrigação de reembolso')`);
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('main button')).some(b=>/pagar|estornar/i.test(b.textContent))`,
    ),
    false,
  );
  if (faults) {
    await navigate(ids.fault);
    await defaults();
    await select(ids.fault, '1');
    await review();
    await faults.concurrent();
    await confirm();
    await until(`document.querySelector('main')?.innerText.includes('mudou')`);
    assert.equal(
      await evaluate(`document.getElementById('correcao-q-${ids.fault.itens[0].id}').value`),
      '1',
    );
    await button('Consultar dados atuais');
    await review();
    await faults.rollback(true);
    await confirm();
    await until(
      `!!document.getElementById('correcao-feedback')&&!document.getElementById('correcao-revisao')`,
    );
    await faults.rollback(false);
    await review();
    await faults.loseReply();
    await confirm();
    await until(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Repetir mesma correção')`,
    );
    await evaluate(`document.querySelector('a[href="#/vendas/${ids.fault.id}"]').click()`);
    await pause(100);
    assert.equal(await evaluate('location.hash'), `#/vendas/${ids.fault.id}/devolver`);
    await button('Repetir mesma correção');
    await until(`!!document.querySelector('[aria-label="Correção concluída"]')`);
    await faults.checkReplay();
    await navigate(ids.fault);
    await defaults();
    await select(ids.fault, '1');
    await review();
    await faults.readFailure();
    await complete();
    await until(`document.querySelector('main')?.innerText.includes('Falhou somente')`);
    await button('Consultar dados atuais');
    await faults.checkRead();
  }
  // Leaving unconfirmed input opens the shared dialog; cancelling preserves fields.
  await navigate(ids.entry);
  await defaults();
  await evaluate(`document.querySelector('a[href="#/vendas/${ids.entry.id}"]').click()`);
  await until(`!!document.querySelector('dialog[open]')`);
  await button('Voltar');
  assert.equal(await evaluate('location.hash'), `#/vendas/${ids.entry.id}/devolver`);
  // Resolve the leave guard before the harness shuts the process down.
  await evaluate(`document.querySelector('a[href="#/vendas/${ids.entry.id}"]').click()`);
  await until(`!!document.querySelector('dialog[open]')`);
  await button('Confirmar');
  await until(`!document.querySelector('dialog[open]')`);
  console.log('CORRECOES_SCENARIO_OK');
};
