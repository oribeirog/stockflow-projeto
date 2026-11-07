// Same purchase-funded financial chain in local, HTTP and packaged Angular/Electron.
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
module.exports = async (options) => {
  const { evaluate, ids } = options;
  const until = async (expr) => {
    for (let n = 0; n < 250; n++) {
      if (await evaluate(expr)) return;
      await pause(30);
    }
    throw Error(
      'Consolidação timeout: ' +
        expr +
        '\n' +
        (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const api = async (expr) => {
    const r = await evaluate('window.mnrApi.' + expr);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const command = (dados) =>
    `({operacaoId:crypto.randomUUID(),motivo:'Ciclo integrado isolado',dados:${JSON.stringify(dados)}})`;
  const button = async (label) => {
    const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled&&!b.closest('fieldset:disabled'))`;
    await until(`!!(${expr})`);
    await evaluate(`${expr}.click()`);
    await pause(60);
  };
  const fill = async (id, value) => {
    await until(`!!document.getElementById(${JSON.stringify(id)})`);
    await evaluate(
      `(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(40);
  };
  const navigate = async (path) => {
    await evaluate(`location.hash=${JSON.stringify('#/' + path)}`);
    await pause(150);
  };
  const confirm = async (label) => {
    await button(label);
    await until(`!!document.querySelector('dialog[open]')`);
    assert.equal(await evaluate('document.activeElement.id'), 'confirm-title');
    await button('Confirmar');
    await until(`!document.querySelector('dialog[open]')`);
    await pause(150);
  };
  await until(`!!window.mnrApi?.financeiro&&!!document.querySelector('nav')`);
  const marca = await api(`cadastros.marcas.salvar(${command({ nome: 'Marca ciclo integrado' })})`);
  const categoria = await api(
    `cadastros.categorias.salvar(${command({ nome: 'Categoria ciclo integrado' })})`,
  );
  const cliente = await api(
    `cadastros.clientes.salvar(${command({ nome: 'Cliente ciclo integrado' })})`,
  );
  const supplier = await api(
    `cadastros.fornecedores.salvar(${command({ nome: 'Fornecedor ciclo integrado' })})`,
  );
  const product = await api(
    `cadastros.produtos.salvar(${command({ nome: 'Perfume ciclo integrado', sku: 'INTEGRADO', marcaId: marca.id, categoriaId: categoria.id, volumeMicrolitros: 1000, precoVendaCentavos: 10000, estoqueMinimo: 0 })})`,
  );
  const buy = async (quantity, unit, total) => {
    await navigate('compras/nova');
    await until(`!!document.querySelector('#compra-fornecedor option[value="${supplier.id}"]')`);
    await fill('compra-fornecedor', String(supplier.id));
    await until(`!!document.querySelector('#compra-produto option[value="${product.id}"]')`);
    await fill('compra-produto', String(product.id));
    await fill('item-q-0', quantity);
    await fill('item-v-0', unit);
    await fill('compra-data', '2026-11-01');
    await fill('compra-motivo', 'Abastecimento do ciclo integrado');
    await button('Adicionar pagamento');
    await fill('pagamento-forma-0', String(ids.cash));
    await fill('pagamento-valor-0', total);
    await button('Salvar e revisar compra');
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    await confirm('Confirmar compra revisada');
    await until(`document.querySelector('main')?.innerText.includes('CONFIRMADO')`);
  };
  await buy('20', '1', '20');
  assert.equal((await api(`estoque.obter(${product.id})`)).quantidade, 20);
  const sales = {};
  const financial = async (id, expected) => {
    const official = await api(`financeiro.obterVenda(${id})`);
    for (const [field, value] of Object.entries(expected))
      assert.equal(official.resumo[field], value);
    await navigate('financeiro/vendas/' + id);
    await until(`!!document.querySelector('[data-financial="saldoReceberCentavos"]')`);
    // Compare every rendered amount with the official main-process response.
    for (const [field, value] of Object.entries(official.resumo)) {
      if (field === 'vendaId') continue;
      const rendered = await evaluate(
        `document.querySelector('[data-financial="${field}"] dd')?.textContent.trim()`,
      );
      assert.equal(typeof rendered, 'string', 'Resumo não apresenta ' + field);
      assert.equal(
        rendered.replace(/\s/g, ''),
        (value / 100)
          .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          .replace(/\s/g, ''),
      );
    }
    return official;
  };
  const receive = async (id, amount) => {
    await navigate(`financeiro/vendas/${id}/receber`);
    await until(
      `!!document.getElementById('receber-data')&&!document.querySelector('fieldset:disabled')`,
    );
    await fill('receber-data', '2026-11-01');
    await fill('receber-motivo', 'Recebimento do ciclo integrado');
    await fill('receber-forma-0', String(ids.pix));
    await fill('receber-valor-0', amount);
    await button('Revisar recebimento');
    await until(`!!document.getElementById('receber-revisao')`);
    await confirm('Confirmar recebimento revisado');
    await until(`!!document.querySelector('[aria-label="Recebimento concluído"]')`);
  };
  for (const mode of ['cash', 'credit', 'entry']) {
    await navigate('vendas/nova');
    await until(`!!document.querySelector('#venda-produto option[value="${product.id}"]')`);
    await fill('venda-cliente', String(cliente.id));
    await fill('venda-produto', String(product.id));
    await fill('item-q-0', '3');
    await fill('venda-data', '2026-11-01');
    await fill('venda-motivo', 'Venda integrada ' + mode);
    if (mode !== 'cash') {
      await fill('venda-modalidade', 'A_PRAZO');
      if (mode === 'entry') await evaluate(`document.getElementById('venda-entrada').click()`);
      await button('Adicionar parcela');
      await fill('parcela-data-0', '2026-12-01');
      await fill('parcela-valor-0', mode === 'credit' ? '300' : '200');
    }
    if (mode !== 'credit') {
      await button('Adicionar pagamento');
      await fill('pagamento-forma-0', String(ids.pix));
      await fill('pagamento-valor-0', mode === 'cash' ? '300' : '100');
    }
    await button(
      mode === 'entry' ? 'Dividir saldo pelos vencimentos e revisar' : 'Salvar e revisar venda',
    );
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    await confirm('Confirmar venda revisada');
    await until(`document.querySelector('main')?.innerText.includes('CONFIRMADO')`);
    const sale = (await api('vendas.listar({})')).itens[0];
    sales[mode] = sale.id;
    await financial(sale.id, {
      recebidoLiquidoCentavos: mode === 'cash' ? 30000 : mode === 'entry' ? 10000 : 0,
      saldoReceberCentavos: mode === 'cash' ? 0 : mode === 'entry' ? 20000 : 30000,
    });
    if (mode === 'credit') {
      await receive(sale.id, '50');
      await financial(sale.id, { saldoReceberCentavos: 25000 });
      await receive(sale.id, '250');
      await financial(sale.id, { saldoReceberCentavos: 0, recebidoLiquidoCentavos: 30000 });
    }
    if (mode === 'entry') {
      await receive(sale.id, '150');
      await financial(sale.id, { saldoReceberCentavos: 5000, recebidoLiquidoCentavos: 25000 });
    }
  }
  assert.equal((await api(`estoque.obter(${product.id})`)).quantidade, 11);
  await buy('5', '100', '500');
  const sale = await api(`vendas.obter(${sales.entry})`),
    item = sale.itens[0].id;
  await navigate(`vendas/${sale.id}/devolver`);
  await until(`!!document.getElementById('correcao-data')`);
  await fill('correcao-data', '2026-11-01');
  await fill('correcao-motivo', 'Devolução integrada mista');
  await evaluate(`document.getElementById('correcao-s-${item}').click()`);
  await fill('correcao-q-' + item, '2');
  await fill('correcao-p-' + item, '1');
  await button('Revisar efeitos oficiais');
  await until(`!!document.getElementById('correcao-revisao')`);
  await confirm('Confirmar correção revisada');
  await until(`!!document.querySelector('[aria-label="Correção concluída"]')`);
  await financial(sale.id, {
    valorComercialLiquidoCentavos: 10000,
    saldoReceberCentavos: 0,
    reembolsosPendentesCentavos: 15000,
  });
  const docs = await api(`correcoes.listarDocumentos({vendaId:${sale.id}})`);
  const doc = await api(
    `correcoes.obterDocumento({vendaId:${sale.id},documentoId:${docs.itens[0].id}})`,
  );
  assert.equal(doc.itens[0].custoHistoricoCentavos, 200);
  const movements = await api(`financeiro.listarMovimentos({vendaId:${sale.id}})`);
  ids.main = {
    saleId: sale.id,
    productId: product.id,
    correcaoId: doc.id,
    reembolsoId: doc.reembolsoIds[0],
    recebimentos: movements.itens
      .filter((m) => m.natureza === 'RECEBIMENTO_CLIENTE')
      .map((m) => m.id),
  };
  // Reuse the already asserted D sequence, including individual Pix/cash reversals and return undo.
  await require('./reembolsos-scenario.cjs')(options);
  await financial(sale.id, {
    valorComercialLiquidoCentavos: 30000,
    saldoReceberCentavos: 5000,
    reembolsosPendentesCentavos: 0,
  });
  console.log(
    'CONSOLIDACAO_CICLO_UI_OK',
    JSON.stringify({ sales, productId: product.id, refundId: doc.reembolsoIds[0] }),
  );
};
