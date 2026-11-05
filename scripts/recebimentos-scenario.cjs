const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
module.exports = async function ({ evaluate, ids, capture, keyboard, faults }) {
  const until = async (expr) => {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(expr)) return;
      await pause(30);
    }
    throw Error(
      'Timeout ' + expr + '\n' + (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const text = () => evaluate('document.querySelector("main")?.innerText');
  const button = async (label) => {
    const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled&&!b.closest('fieldset:disabled'))`;
    await until(`!!(${expr})`);
    await evaluate(`${expr}.click()`);
    await pause(50);
  };
  const fill = async (id, value) => {
    await until(`!!document.getElementById(${JSON.stringify(id)})`);
    await evaluate(
      `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(40);
  };
  const api = async (expr) => {
    const r = await evaluate('window.mnrApi.financeiro.' + expr);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const navigate = async (sale, parcel) => {
    await evaluate(
      `location.hash=${JSON.stringify('#/financeiro/vendas/' + sale.id + '/receber' + (parcel ? '?parcelaId=' + parcel : ''))}`,
    );
    await until(
      `!!document.getElementById('receber-data')&&!document.querySelector('fieldset:disabled')`,
    );
    await pause(60);
  };
  const defaults = async (value = '50') => {
    await fill('receber-data', '2026-11-01');
    await fill('receber-motivo', 'Recebimento da dívida existente');
    await fill('receber-forma-0', String(ids.pix));
    await fill('receber-valor-0', value);
  };
  const review = async () => {
    await button('Revisar recebimento');
    await until(`!!document.getElementById('receber-revisao')`);
  };
  const confirm = async () => {
    await button('Confirmar recebimento revisado');
    await until(`!!document.querySelector('dialog[open]')`);
    await until(
      `!!Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar')`,
    );
    await evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar');b.click();b.click();})()`,
    );
    await pause(60);
  };
  const complete = async () => {
    await confirm();
    await until(
      `!!document.querySelector('[aria-label="Recebimento concluído"]')&&!document.querySelector('fieldset:disabled')`,
    );
  };
  const fresh = async () => {
    await button('Registrar outro recebimento');
    await until(`!!document.getElementById('receber-data')`);
    await pause(80);
  };
  const select = async (id) => {
    await evaluate(`document.getElementById('receber-selecao-${id}').click()`);
    await pause(40);
  };
  await until('!!window.mnrApi?.financeiro&&!!document.querySelector("nav")');
  assert.equal(await evaluate('typeof require'), 'undefined');
  // Start using the actual account and parcel links, which must preserve the chosen parcel.
  await evaluate(`location.hash='#/financeiro/parcelas'`);
  await until('!!document.getElementById("financeiro-resultados")');
  await evaluate(
    `document.querySelector('a[href="#/financeiro/parcelas/${ids.main.parcelas[0].id}"]').click()`,
  );
  await until(`!!document.querySelector('a[href*="/receber"]')`);
  await evaluate(`document.querySelector('a[href*="/receber"]').click()`);
  await until('!!document.getElementById("receber-data")');
  await pause(100);
  assert.equal(await evaluate('document.getElementById("receber-modalidade").value'), 'MANUAL');
  assert.match(await text(), /Cliente histórico recebimentos/);
  assert.match(await text(), /inativo/);
  const first = ids.main.parcelas[0].id;
  await defaults();
  await fill('receber-alocacao-' + first, '50');
  await fill('receber-valor-0', '0');
  await button('Revisar recebimento');
  assert.match(await text(), /maior que zero/);
  await fill('receber-valor-0', '50');
  await fill('receber-data', '2026-02-30');
  await button('Revisar recebimento');
  assert.match(await text(), /data válida/);
  await fill('receber-data', '2026-11-01');
  await fill('receber-valor-0', '400');
  await button('Revisar recebimento');
  await until(`document.querySelector('main').innerText.includes('excede o saldo')`);
  await fill('receber-valor-0', '50');
  await fill('receber-alocacao-' + first, '40');
  await button('Revisar recebimento');
  await until(`document.querySelector('main').innerText.includes('soma das alocações')`);
  await fill('receber-alocacao-' + first, '50');
  await review();
  await fill('receber-motivo', 'Motivo alterado invalida revisão');
  assert.equal(await evaluate('!!document.getElementById("receber-revisao")'), false);
  await fill('receber-modalidade', 'AUTO');
  await fill('receber-modalidade', 'MANUAL');
  await review();
  await capture?.('revisao');
  await keyboard?.();
  await complete();
  let p = await api(`obterParcela(${first})`);
  assert.equal(p.saldoCentavos, 5000);
  await fresh();
  await defaults();
  await review();
  await complete();
  p = await api(`obterParcela(${first})`);
  assert.equal(p.saldoCentavos, 0);
  assert.equal(p.status, 'QUITADO');
  await fresh();
  await defaults('100');
  await fill('receber-modalidade', 'MANUAL');
  await select(ids.main.parcelas[1].id);
  await fill('receber-alocacao-' + ids.main.parcelas[1].id, '100');
  await review();
  await complete();
  await fresh();
  await defaults('60');
  await button('Adicionar forma de recebimento');
  await fill('receber-forma-1', String(ids.cash));
  await fill('receber-valor-1', '40');
  await review();
  await complete();
  const summary = await api(`obterVenda(${ids.main.id})`);
  assert.equal(summary.resumo.saldoReceberCentavos, 0);
  assert.equal(summary.resumo.recebimentosEfetivosCentavos, 30000);
  assert.match(await text(), /Saldo após esta operação: R\$\s*0,00/);
  const movements = await api(`listarMovimentos({vendaId:${ids.main.id}})`);
  assert.equal(movements.itens.length, 5, 'Repeated clicks must not duplicate payments');
  for (const movement of movements.itens) {
    const detail = await api(`obterMovimento({vendaId:${ids.main.id},movimentoId:${movement.id}})`);
    assert.ok(detail.alocacoes.length);
  }
  await capture?.('concluido');
  // Manual partial amounts in multiple parcels; the backend alone validates distribution.
  await navigate(ids.other);
  await defaults('50');
  await fill('receber-modalidade', 'MANUAL');
  for (const parcel of ids.other.parcelas.slice(0, 2)) {
    await select(parcel.id);
    await fill('receber-alocacao-' + parcel.id, '25');
  }
  await review();
  await complete();
  const rows = await api(`listarParcelas({vendaId:${ids.other.id},situacao:'TODAS'})`);
  assert.deepEqual(
    rows.itens.slice(0, 2).map((p) => p.saldoCentavos),
    [7500, 7500],
  );
  // Entry is historical money already received, never offered again for allocation.
  await navigate(ids.entry);
  await defaults('50');
  await review();
  await complete();
  assert.equal(
    (await api(`obterVenda(${ids.entry.id})`)).resumo.recebimentosEfetivosCentavos,
    15000,
  );
  if (faults) {
    await navigate(ids.fault);
    await defaults();
    await review();
    await faults.concurrent();
    await confirm();
    await until(`document.querySelector('main').innerText.includes('financeiro mudou')`);
    await button('Consultar saldos novamente');
    await pause(100);
    await review();
    await faults.loseReply();
    await confirm();
    await until(`document.querySelector('main').innerText.includes('Repetir o mesmo recebimento')`);
    assert.equal(await evaluate('document.querySelector("fieldset").disabled'), true);
    assert.equal(
      await evaluate(
        `(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()`,
      ),
      true,
    );
    await evaluate(`document.querySelector('#main-navigation a[href="#/vendas"]').click()`);
    await pause(100);
    assert.match(await evaluate('location.hash'), /receber/);
    await button('Repetir o mesmo recebimento');
    await until(`!!document.querySelector('[aria-label="Recebimento concluído"]')`);
    await faults.checkReplay();
    await fresh();
    await defaults('10');
    await faults.inactive(true);
    await button('Revisar recebimento');
    await until(
      `document.querySelector('main').innerText.includes('forma de pagamento está inativa')`,
    );
    await faults.inactive(false);
    await review();
    await faults.rollback(true);
    await confirm();
    await until(`document.querySelector('.receipt-feedback')?.innerText.includes('desfeita')`);
    await faults.rollback(false);
    await review();
    await faults.readFailure();
    await complete();
    await until(`document.querySelector('main').innerText.includes('Falhou apenas')`);
    await button('Consultar saldos novamente');
    await pause(100);
    await faults.checkRead();
  }
  await evaluate(`location.hash='#/financeiro/vendas/${ids.main.id}'`);
  await until(`!!document.querySelector('[data-financial="saldoReceberCentavos"]')`);
  assert.match(await text(), /300,00/);
  console.log('RECEBIMENTOS_SCENARIO_OK');
};
