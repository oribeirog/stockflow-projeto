// Test-only UI scenario, shared by real local, HTTP and packaged renderer hosts.
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
module.exports = async function run({
  evaluate,
  offline,
  lostReply,
  capture,
  keyboard,
  reopen,
  rollback,
}) {
  const until = async (expression) => {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(expression)) return;
      await pause(30);
    }
    throw Error(
      'Timeout: ' +
        expression +
        '\n' +
        (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const button = async (label) => {
    const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(`!!(${expr})`);
    await evaluate(`${expr}.click()`);
    await pause(50);
  };
  const fill = async (selector, value) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(30);
  };
  const api = async (expression) => {
    const r = await evaluate(expression);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const cmd = (d) =>
    `({operacaoId:crypto.randomUUID(),motivo:'Vendas fixture isolada',dados:${JSON.stringify(d)}})`;
  await until(`!!window.mnrApi?.vendas&&!!document.querySelector('nav')`);
  assert.equal(await evaluate(`typeof require`), 'undefined');
  assert.equal(
    await evaluate(
      `!!window.mnrApi.correcoes.estornarDevolucao||!!window.mnrApi.financeiro.pagarCompra||!!window.mnrApi.correcoes.estornarAjuste`,
    ),
    false,
  );
  const marca = await api(
    `window.mnrApi.cadastros.marcas.salvar(${cmd({ nome: 'Marca vendas' })})`,
  );
  const categoria = await api(
    `window.mnrApi.cadastros.categorias.salvar(${cmd({ nome: 'Categoria vendas' })})`,
  );
  const client = await api(
    `window.mnrApi.cadastros.clientes.salvar(${cmd({ nome: 'Cliente original vendas' })})`,
  );
  const pix = await api(`window.mnrApi.cadastros.formasPagamento.salvar(${cmd({ nome: 'Pix' })})`);
  const cash = await api(
    `window.mnrApi.cadastros.formasPagamento.salvar(${cmd({ nome: 'Dinheiro' })})`,
  );
  const product = await api(
    `window.mnrApi.cadastros.produtos.salvar(${cmd({ nome: 'Perfume vendas', sku: 'VENDA', marcaId: marca.id, categoriaId: categoria.id, volumeMicrolitros: 1000, precoVendaCentavos: 200, estoqueMinimo: 0 })})`,
  );
  const stock = (q, c) =>
    api(
      `window.mnrApi.estoque.registrarEntrada({operacaoId:crypto.randomUUID(),motivo:'Fixture vendas',dataEfetiva:'2026-10-31',dados:{produtoId:${product.id},quantidade:${q},custoTotalCentavos:${c}}})`,
    );
  await stock(30, 3000);
  const navigate = async (path) => {
    if (await evaluate(`location.hash===${JSON.stringify('#/' + path)}`)) {
      await evaluate(`location.hash='#/vendas'`);
      await pause(100);
    }
    await evaluate(`location.hash=${JSON.stringify('#/' + path)}`);
    await pause(100);
  };
  await navigate('vendas');
  await until(`!!document.querySelector('mnr-vendas')`);
  for (const mode of ['cash', 'credit', 'entry']) {
    await navigate('vendas/nova');
    await until(`!!document.querySelector('#venda-produto option[value="${product.id}"]')`);
    await fill('#venda-cliente', String(client.id));
    await fill('#venda-produto', String(product.id));
    await fill('#item-q-0', '2');
    await fill('#venda-data', '2026-10-31');
    await fill('#venda-motivo', 'Venda ' + mode);
    await fill('#venda-desconto', '0,01');
    if (mode === 'cash') await fill('#venda-cliente', '');
    if (mode === 'entry') await fill('#venda-modalidade', 'A_PRAZO');
    await button('Salvar rascunho');
    const saved = (await api('window.mnrApi.vendas.listar({})')).itens[0];
    const originalVersion = (await api(`window.mnrApi.vendas.obter(${saved.id})`)).versao;
    await button('Voltar às vendas');
    await navigate('vendas/' + saved.id);
    await until(`!!document.querySelector('#venda-motivo')`);
    assert.equal(
      await evaluate(`document.querySelector('#venda-cliente').value`),
      mode === 'cash' ? '' : String(client.id),
    );
    assert.equal(
      await evaluate(`document.querySelector('#venda-modalidade').value`),
      mode === 'entry' ? 'A_PRAZO' : 'A_VISTA',
    );
    assert.equal(await evaluate(`document.querySelector('#venda-motivo').value`), '');
    assert.equal(await evaluate(`document.querySelector('#venda-motivo').required`), false);
    // A failed credit attempt, repeated transitions, then cash in the same editor.
    if (mode === 'cash') {
      for (let n = 0; n < 2; n++) {
        await fill('#venda-modalidade', 'A_PRAZO');
        await button('Adicionar parcela');
        await fill('#parcela-valor-0', '');
        await button('Salvar e revisar venda');
        assert.equal(
          await evaluate(`!!document.querySelector('[aria-label="Revisão pronta"]')`),
          false,
        );
        await fill('#venda-modalidade', 'A_VISTA');
        assert.equal(await evaluate(`!!document.querySelector('#parcela-valor-0')`), false);
      }
    }
    if (mode !== 'cash') {
      await fill('#venda-modalidade', 'A_PRAZO');
      if (mode === 'entry') await evaluate(`document.querySelector('#venda-entrada').click()`);
      await button('Adicionar parcela');
      await fill('#parcela-data-0', '2026-11-10');
      await button('Adicionar parcela');
      await fill('#parcela-data-1', '2026-12-10');
      if (mode === 'credit') {
        await fill('#parcela-valor-1', '1,99');
        for (const value of ['', '0', '4,00', '1,00']) {
          await fill('#parcela-valor-0', value);
          await button('Salvar e revisar venda');
          assert.equal(
            await evaluate(`!!document.querySelector('[aria-label="Revisão pronta"]')`),
            false,
          );
          assert.match(
            await evaluate(`document.querySelector('.feedback').textContent`),
            /Parcela|soma das parcelas/,
          );
        }
        await fill('#parcela-valor-0', '2,00');
        for (const date of ['', '2026-02-30', '2026-10-30']) {
          await fill('#parcela-data-0', date);
          await button('Salvar e revisar venda');
          assert.match(
            await evaluate(`document.querySelector('.feedback').textContent`),
            /Parcela 1.*vencimento/,
          );
          assert.equal(await evaluate(`document.activeElement.id`), 'parcela-data-0');
          assert.equal(
            await evaluate(
              `document.querySelector('#parcela-data-0').getAttribute('aria-invalid')`,
            ),
            'true',
          );
        }
        await fill('#parcela-data-0', '2026-11-10');
      }
    }
    if (mode !== 'credit') {
      await button('Adicionar pagamento');
      await fill('#pagamento-forma-0', String(pix.id));
      await fill('#pagamento-valor-0', mode === 'cash' ? '1,99' : '1,00');
      if (mode === 'cash') {
        await button('Adicionar pagamento');
        await fill('#pagamento-forma-1', String(cash.id));
        await fill('#pagamento-valor-1', '2,00');
      }
    }
    const review = () =>
      button(
        mode === 'entry' ? 'Dividir saldo pelos vencimentos e revisar' : 'Salvar e revisar venda',
      );
    await review();
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    const reviewedVersion = (await api(`window.mnrApi.vendas.obter(${saved.id})`)).versao;
    // Only a persisted modality change saves; ordinary financial edits never save the items.
    if (mode !== 'cash')
      assert.equal(reviewedVersion, originalVersion + (mode === 'credit' ? 1 : 0));
    await fill(
      mode === 'credit' ? '#parcela-valor-0' : '#pagamento-valor-0',
      mode === 'credit' ? '2,00' : mode === 'cash' ? '1,99' : '1,00',
    );
    assert.equal(
      await evaluate(`!!document.querySelector('[aria-label="Revisão pronta"]')`),
      false,
    );
    await review();
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    assert.equal((await api(`window.mnrApi.vendas.obter(${saved.id})`)).versao, reviewedVersion);
    assert.equal(await evaluate(`document.querySelector('#venda-motivo').required`), false);
    await fill('#item-q-0', '3');
    await button('Salvar e revisar venda');
    assert.match(
      await evaluate(`document.querySelector('.feedback').textContent`),
      /justificativa/,
    );
    await fill('#item-q-0', '2');
    await review();
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    assert.equal((await api(`window.mnrApi.vendas.obter(${saved.id})`)).versao, reviewedVersion);
    if (mode === 'credit') {
      const d = await api(`window.mnrApi.vendas.obter(${saved.id})`);
      const external = {
        id: d.id,
        versaoEsperada: d.versao,
        clienteId: d.clienteId,
        modalidadeVenda: d.modalidadeVenda,
        dataComercial: d.dataComercial,
        descontoGlobal: { tipo: 'CENTAVOS', valor: d.descontoGlobalCentavos },
        observacoes: 'Observação externa',
        itens: d.itens.map((i) => ({
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          valorUnitarioCentavos: i.valorUnitarioCentavos,
          desconto: { tipo: 'CENTAVOS', valor: i.descontoItemCentavos },
          motivo: i.motivo,
        })),
      };
      await api(`window.mnrApi.vendas.salvarRascunho(${cmd(external)})`);
      await fill('#venda-observacoes', 'Edição local');
      await fill('#venda-motivo', 'Edição com conflito');
      await review();
      await button('Consultar versão atual preservando preenchimento');
      assert.equal(
        await evaluate(`document.querySelector('#venda-observacoes').value`),
        'Edição local',
      );
      await fill('#venda-motivo', '');
      await fill('#venda-observacoes', '');
      await review();
      assert.match(
        await evaluate(`document.querySelector('.feedback').textContent`),
        /justificativa/,
      );
      await fill('#venda-observacoes', 'Observação externa');
      await review();
      await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
      assert.equal((await api(`window.mnrApi.vendas.obter(${saved.id})`)).versao, d.versao + 1);
    }
    // A real commercial change still needs a reason and a new persisted version.
    await fill('#venda-observacoes', 'Revisao invalidada');
    assert.equal(
      await evaluate(`!!document.querySelector('[aria-label="Revisão pronta"]')`),
      false,
    );
    await fill('#venda-motivo', 'Alteração comercial após reabertura');
    await review();
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    await fill('#venda-motivo', '');
    await review();
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    if (mode === 'cash') {
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('mnr-venda-editor input,mnr-venda-editor select,mnr-venda-editor textarea')).every(e=>e.labels.length>0)`,
        ),
        true,
      );
      if (rollback) {
        await rollback(true);
        await button('Confirmar venda revisada');
        await button('Confirmar');
        await until(`document.querySelector('main').innerText.includes('A operação foi desfeita')`);
        assert.equal((await api(`window.mnrApi.estoque.obter(${product.id})`)).quantidade, 30);
        assert.equal((await api('window.mnrApi.vendas.listar({})')).itens[0].estado, 'RASCUNHO');
        await rollback(false);
        await review();
        await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
      }
      if (capture) await capture();
      await button('Confirmar venda revisada');
      await until(`!!document.querySelector('mnr-confirm dialog[open]')`);
      if (keyboard) await keyboard();
      await button('Voltar');
      await until(`!document.querySelector('mnr-confirm')`);
      assert.equal(
        await evaluate(`document.activeElement.textContent.trim()`),
        'Confirmar venda revisada',
      );
      await lostReply?.();
    }
    await offline();
    await button('Confirmar venda revisada');
    await button('Confirmar');
    if (mode === 'cash' && lostReply) {
      await until(
        `document.querySelector('mnr-venda-editor').innerText.includes('Repetir o mesmo comando')`,
      );
      await button('Repetir o mesmo comando');
    }
    await until(
      `document.querySelector('mnr-venda-editor').innerText.includes('Venda confirmada')`,
    );
    const rows = await api('window.mnrApi.vendas.listar({})'),
      d = await api(`window.mnrApi.vendas.obter(${rows.itens[0].id})`);
    assert.equal(d.totalCentavos, 399);
    assert.equal(d.recebidoConfirmacaoCentavos, mode === 'cash' ? 399 : mode === 'entry' ? 100 : 0);
    assert.equal(
      d.financeiro.saldoReceberCentavos,
      mode === 'cash' ? 0 : mode === 'entry' ? 299 : 399,
    );
    assert.equal(d.pagamentos.length, mode === 'cash' ? 2 : mode === 'entry' ? 1 : 0);
    if (mode === 'entry') {
      assert.equal(d.parcelasFinanceiras[0].tipo, 'ENTRADA');
      assert.equal(d.parcelasFinanceiras[0].saldoCentavos, 0);
    }
    assert.equal(
      (await api(`window.mnrApi.estoque.obter(${product.id})`)).quantidade,
      mode === 'cash' ? 28 : mode === 'credit' ? 26 : 24,
    );
    assert.ok(
      (await evaluate(`document.querySelector('main').innerText`)).includes('Saldo exigível atual'),
    );
  }
  // Review errors preserve the editable draft, followed by explicit below-cost justification.
  await navigate('vendas/nova');
  await until(`!!document.querySelector('#venda-produto option[value="${product.id}"]')`);
  await fill('#venda-produto', String(product.id));
  await fill('#item-q-0', '100');
  await fill('#venda-motivo', 'Estoque insuficiente');
  await button('Adicionar pagamento');
  await fill('#pagamento-forma-0', String(pix.id));
  await fill('#pagamento-valor-0', '200,00');
  await button('Salvar e revisar venda');
  await until(`document.querySelector('main').innerText.includes('Estoque insuficiente')`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Revisão pronta"]')`), false);
  await fill('#item-q-0', '1');
  await fill('#item-v-0', '0,50');
  await fill('#pagamento-valor-0', '0,50');
  await button('Salvar e revisar venda');
  await until(`document.querySelector('main').innerText.includes('Preço abaixo do custo')`);
  await fill('#item-m-0', 'Promocao autorizada');
  await button('Salvar e revisar venda');
  await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
  await button('Confirmar venda revisada');
  await button('Confirmar');
  await until(`document.querySelector('main').innerText.includes('Venda confirmada')`);
  const rows = await api('window.mnrApi.vendas.listar({})');
  assert.equal(rows.itens.length, 4);
  const id = rows.itens[0].id;
  await navigate('vendas/' + id);
  await until(`document.querySelector('main').innerText.includes('Saldo exigível atual')`);
  if (reopen) await reopen(id);
  // Discard a committed response and replay the exact immutable envelope.
  await evaluate(`(async()=>{
    const d=await window.mnrApi.vendas.salvarRascunho(${cmd({ modalidadeVenda: 'A_VISTA', dataComercial: '2026-10-31', itens: [{ produtoId: product.id, quantidade: 1, valorUnitarioCentavos: 200 }] })});
    if(!d.ok)throw Error(JSON.stringify(d));
    const r=await window.mnrApi.vendas.revisarPlano({id:d.data.id,versaoEsperada:d.data.versao,comEntrada:false,pagamentos:[{formaPagamentoId:${pix.id},valorCentavos:200}],parcelas:[]});
    if(!r.ok)throw Error(JSON.stringify(r));
    const {comEntrada,...plan}=r.data.plano;
    const c={operacaoId:crypto.randomUUID(),motivo:'Resposta descartada',dados:{...plan,revisao:r.data.revisao}};
    await window.mnrApi.vendas.confirmar(c);
    const retry=await window.mnrApi.vendas.confirmar(c);
    if(!retry.ok||retry.data.pagamentos.length!==1)throw Error('Replay inconsistente');
  })()`);
  assert.equal((await api(`window.mnrApi.estoque.obter(${product.id})`)).quantidade, 22);
  console.log('VENDAS_SCENARIO_OK');
};
