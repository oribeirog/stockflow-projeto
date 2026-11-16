// Shared, test-only catalog flow for the actual local/HTTP/ASAR application.
import assert from 'node:assert/strict';
export async function catalogScenario({ e, until, click, key, call, m, mode }) {
  const api = async (expression) => {
    const r = await e(expression);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const command = (d) =>
    `({operacaoId:crypto.randomUUID(),motivo:'Catálogo universal isolado',dados:${JSON.stringify(d)}})`;
  const fill = async (selector, value) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await e(
      `(()=>{const x=document.querySelector(${JSON.stringify(selector)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event(x.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  };
  const route = async (path) => {
    await e(`location.hash=${JSON.stringify('#/' + path)}`);
  };
  const brand = await api(
    `window.mnrApi.cadastros.marcas.salvar(${command({ nome: 'Marca universal' })})`,
  );
  const category = await api(
    `window.mnrApi.cadastros.categorias.salvar(${command({ nome: 'Mercadorias diversas' })})`,
  );
  const products = [];
  for (const [index, nome, unidade] of [
    [0, 'Perfume como produto comum', 'FR'],
    [1, 'Carteira à mão + acessórios', 'CX'],
    [2, 'Cosmético diário', 'UN'],
  ]) {
    await route('produtos');
    await until(`!!document.getElementById('produto-search')`);
    await route('produtos/novo');
    await until(`!!document.getElementById('produto-nome')`);
    assert.equal(await e(`!!document.querySelector('[id*="volume"],[id*="concentracao"]')`), false);
    if (index === 0) {
      await click('Salvar produto');
      await until(`document.getElementById('produto-nome').getAttribute('aria-invalid')==='true'`);
      assert.equal(await e('document.activeElement.id'), 'produto-nome');
    }
    await fill('#produto-nome', nome);
    await fill('#produto-sku', 'UNIVERSAL-' + index);
    if (index === 1) await fill('#produto-codigoBarras', '000000123456');
    await until(`!!document.querySelector('#marca-select option[value="${brand.id}"]')`);
    await fill('#marca-select', String(brand.id));
    await until(`!!document.querySelector('#categoria-select option[value="${category.id}"]')`);
    await fill('#categoria-select', String(category.id));
    await fill('#produto-unidade', unidade);
    await fill('#produto-preco', '50,01');
    await fill(
      '#produto-descricao',
      'Características gerais com acentos: ação, higiene e acessórios.',
    );
    await click('Salvar produto');
    await until(`!!document.querySelector('.feedback.success')`);
    const p = (
      await api(`window.mnrApi.cadastros.produtos.listar({busca:'UNIVERSAL-${index}'})`)
    )[0];
    assert.equal(p.nome, nome);
    assert.equal(p.unidadeComercial, unidade);
    products.push(p);
    assert.equal(await e(`document.getElementById('produto-unidade').disabled`), true);
  }
  const p = products[1];
  await route('produtos');
  await until(`!!document.getElementById('produto-search')`);
  for (const busca of ['Carteira à mão', 'UNIVERSAL-1', '000000123456']) {
    await fill('#produto-search', busca);
    await until(`document.querySelector('tbody')?.innerText.includes('UNIVERSAL-1')`);
    assert(await e(`document.querySelector('tbody').innerText.includes('CX')`));
  }
  await key('Tab');
  await key('Tab', 8);
  assert(await e('!!document.activeElement'));
  for (const [width, height] of [
    [1366, 768],
    [1000, 700],
    [640, 480],
  ])
    for (const zoom of [1, 1.25, 1.5]) {
      await m(
        `process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('#/produtos')).setContentSize(${width},${height})`,
      );
      await call('Emulation.setDeviceMetricsOverride', {
        width: Math.round(width / zoom),
        height: Math.round(height / zoom),
        deviceScaleFactor: zoom,
        mobile: false,
      });
      assert(
        await e('document.documentElement.scrollWidth<=innerWidth+1'),
        `${mode} catalog ${width} ${zoom}`,
      );
    }
  await m(
    `process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('#/produtos')).setContentSize(1366,768)`,
  );
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const fs = await import('node:fs');
  await call('Page.bringToFront');
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: false });
  fs.writeFileSync(`.cache/ui/catalogo-${mode}.png`, Buffer.from(shot.data, 'base64'));
  const supplier = await api(
    `window.mnrApi.cadastros.fornecedores.salvar(${command({ nome: 'Fornecedor universal' })})`,
  );
  const form = await api(
    `window.mnrApi.cadastros.formasPagamento.salvar(${command({ nome: 'Pagamento universal' })})`,
  );
  const docs = [];
  for (const [kind, path, label, q, v, total] of [
    ['compras', 'compra', 'compra', 10, '20,00', '200,00'],
    ['vendas', 'venda', 'venda', 2, '50,01', '100,02'],
  ]) {
    await route(kind + '/' + (kind === 'compras' ? 'nova' : 'nova'));
    await until(`!!document.getElementById('${path}-produto')`);
    if (kind === 'compras') {
      await until(`!!document.querySelector('#compra-fornecedor option[value="${supplier.id}"]')`);
      await fill('#compra-fornecedor', String(supplier.id));
    }
    await fill('#' + path + '-produto-busca', '000000123456');
    await until(`!!document.querySelector('#${path}-produto option[value="${p.id}"]')`);
    assert(
      await e(
        `document.querySelector('#${path}-produto option[value="${p.id}"]').innerText.includes('CX')`,
      ),
    );
    await fill('#' + path + '-produto', String(p.id));
    await fill('#item-q-0', String(q));
    await fill('#item-v-0', v);
    await fill('#' + path + '-data', '2026-11-01');
    await fill('#' + path + '-motivo', 'Operação universal ' + label);
    await click('Salvar rascunho');
    await until("document.querySelector('.feedback')?.innerText.includes('salvo')");
    const draftId = (await api(`window.mnrApi.${kind}.listar({})`)).itens[0].id;
    await click('Voltar às ' + kind);
    await until(`!!document.querySelector('mnr-${kind}')`);
    await route(kind + '/' + draftId);
    await until(`!!document.getElementById('${path}-motivo')`);
    await until(
      "Array.from(document.querySelectorAll('legend')).some(x=>x.innerText.includes('CX'))",
    );
    await click('Adicionar pagamento');
    await until(`!!document.querySelector('#pagamento-forma-0 option[value="${form.id}"]')`);
    await fill('#pagamento-forma-0', String(form.id));
    await fill('#pagamento-valor-0', total);
    await click('Salvar e revisar ' + label);
    await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
    await click('Confirmar ' + label + ' revisada');
    await until(`!!document.querySelector('dialog[open]')`);
    await key('Escape');
    await until(`!document.querySelector('dialog[open]')`);
    await click('Confirmar ' + label + ' revisada');
    await until(`!!document.querySelector('dialog[open]')`);
    await click('Confirmar');
    await until(`document.querySelector('.feedback')?.innerText.includes('confirmada')`);
    const d = (await api(`window.mnrApi.${kind}.listar({})`)).itens[0];
    const doc = await api(`window.mnrApi.${kind}.obter(${d.id})`);
    assert.equal(doc.itens[0].unidadeHistorica, 'CX');
    docs.push(doc);
  }
  const b = await api(`window.mnrApi.estoque.obter(${p.id})`);
  assert.equal(b.quantidade, 8);
  assert.equal(b.valorTotalCentavos, 16000);
  assert.equal(b.unidadeComercial, 'CX');
  assert.equal(docs[1].itens[0].valorCustoEstoqueCentavos, 4000);
  const { criadoEm, atualizadoEm, ...edit } = p;
  void criadoEm;
  void atualizadoEm;
  await api(
    `window.mnrApi.cadastros.produtos.salvar(${command({ ...edit, nome: 'Carteira atual renomeada', categoriaId: category.id, ativo: false })})`,
  );
  const historical = await api(`window.mnrApi.vendas.obter(${docs[1].id})`);
  assert.deepEqual(historical.itens, docs[1].itens);
  await route('dashboard');
  await until(`!!document.querySelector('mnr-dashboard')`);
  const perf = [];
  for (const busca of ['UNIVERSAL-1', '000000123456']) {
    const start = performance.now();
    for (let i = 0; i < 20; i++)
      assert.equal(
        (await api(`window.mnrApi.cadastros.produtos.listar({busca:${JSON.stringify(busca)}})`))[0]
          .id,
        p.id,
      );
    perf.push({ busca, requests: 20, ipcTotalMs: performance.now() - start });
  }
  // Main-side timing excludes renderer IPC and does not mutate business data.
  const memory = await m('process.memoryUsage()');
  return {
    products: products.map((x) => ({ id: x.id, sku: x.sku, unidade: x.unidadeComercial })),
    documents: docs.map((d) => d.id),
    stock: b,
    perf,
    memory,
  };
}
