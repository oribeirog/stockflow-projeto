// Recovered from the validated session. Test host only; real production IPC and SQLite.
const { app, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
const { writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    verify(win).then(
      () => {
        console.log('COMPRAS_UI_OK');
        app.quit();
      },
      (e) => {
        console.error(e);
        app.exit(1);
      },
    );
  });
});
require('../dist/electron/main/index.js');
async function verify(win) {
  const web = win.webContents;
  const evaluate = (s) => web.executeJavaScript(s);
  const until = async (s) => {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(s)) return;
      await pause(30);
    }
    throw Error(
      'Timeout: ' + s + '\n' + (await evaluate('document.querySelector("main").innerText')),
    );
  };
  const click = async (s) => {
    await until(`!!document.querySelector(${JSON.stringify(s)})`);
    await evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
    await pause(80);
  };
  const button = async (text) => {
    const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
    await until(`!!(${expr})`);
    await evaluate(`${expr}.click()`);
    await pause(80);
  };
  const fill = async (s, value) => {
    await until(`!!document.querySelector(${JSON.stringify(s)})`);
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause(50);
  };
  const key = async (keyCode, modifiers = []) => {
    win.focus();
    web.focus();
    web.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') web.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    web.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(80);
  };
  const api = async (expr) => {
    const r = await evaluate(expr);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data;
  };
  const cmd = (d) =>
    `({operacaoId:crypto.randomUUID(),motivo:'Fixture compras UI',dados:${JSON.stringify(d)}})`;
  await until(`!!window.mnrApi&&!!document.querySelector('nav')`);
  assert.equal(
    await evaluate('location.origin'),
    process.env.MNR_COMPRAS_EXPECT_HTTP === '1' ? 'http://127.0.0.1:4200' : 'mnr://app',
  );
  assert.deepEqual(await api('window.mnrApi.cadastros.formasPagamento.listar({})'), []);
  const marca = await api(
    `window.mnrApi.cadastros.marcas.salvar(${cmd({ nome: 'Marca compras UI' })})`,
  );
  const categoria = await api(
    `window.mnrApi.cadastros.categorias.salvar(${cmd({ nome: 'Categoria compras UI' })})`,
  );
  const supplier = await api(
    `window.mnrApi.cadastros.fornecedores.salvar(${cmd({ nome: 'Fornecedor compras UI' })})`,
  );
  const base = {
    marcaId: marca.id,
    categoriaId: categoria.id,
    volumeMicrolitros: 1000,
    precoVendaCentavos: 0,
    estoqueMinimo: 0,
  };
  const p1 = await api(
    `window.mnrApi.cadastros.produtos.salvar(${cmd({ ...base, nome: 'Perfume A compras', sku: 'CMP-A' })})`,
  );
  const p2 = await api(
    `window.mnrApi.cadastros.produtos.salvar(${cmd({ ...base, nome: 'Perfume B compras', sku: 'CMP-B' })})`,
  );
  await click('nav a[href="#/compras"]');
  await click('a[href="#/compras/nova"]');
  await until(
    `document.querySelector('mnr-compra-editor')?.innerText.includes('Nenhuma forma ativa')`,
  );
  await button('Gerenciar formas de pagamento');
  await until(`!!document.querySelector('dialog[open] mnr-formas-pagamento')`);
  assert.equal(await evaluate(`!!document.activeElement.closest('dialog[open]')`), true);
  await key('Tab');
  assert.equal(await evaluate(`!!document.activeElement.closest('dialog[open]')`), true);
  await key('Tab', ['shift']);
  assert.equal(await evaluate(`!!document.activeElement.closest('dialog[open]')`), true);
  await key('Escape');
  await until(`!document.querySelector('mnr-formas-pagamento')`);
  assert.equal(
    await evaluate('document.activeElement.textContent.trim()'),
    'Gerenciar formas de pagamento',
  );
  await key('Enter');
  await until(`!!document.querySelector('dialog[open] mnr-formas-pagamento')`);
  const createForm = async (name) => {
    await button('Cadastrar forma');
    if (name === 'Pix') {
      await button('Salvar forma');
      await until(`document.querySelector('#forma-nome')?.getAttribute('aria-invalid')==='true'`);
      assert.equal(await evaluate('document.activeElement.id'), 'forma-nome');
      assert.equal(
        await evaluate(`document.querySelector('#forma-nome').getAttribute('aria-describedby')`),
        'forma-nome-error',
      );
    }
    await fill('#forma-nome', name);
    await fill('#forma-motivo', 'Configuração inicial');
    await button('Salvar forma');
    await button('Confirmar');
    await until(`!document.querySelector('#forma-nome')`);
  };
  await createForm('Pix');
  await createForm('Dinheiro');
  mkdirSync(resolve('.cache/ui'), { recursive: true });
  const capture = async (kind) => {
    for (const [w, h] of [
      [1366, 768],
      [1000, 700],
      [640, 480],
    ])
      for (const zoom of [1, 1.25, 1.5]) {
        win.setSize(w, h);
        web.setZoomFactor(zoom);
        await pause(80);
        if (kind === 'compras')
          await evaluate(`document.querySelector('#compra-fornecedor').scrollIntoView()`);
        writeFileSync(
          resolve(`.cache/ui/${kind}-${w}-${zoom}.png`),
          (await web.capturePage()).toPNG(),
        );
        assert.equal(
          await evaluate(
            `document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`,
          ),
          true,
        );
      }
    win.setSize(1000, 700);
    web.setZoomFactor(1);
  };
  await capture('formas');
  const forms = await api('window.mnrApi.cadastros.formasPagamento.listar({})');
  assert.equal(forms.length, 2);
  const pix = forms.find((f) => f.nome === 'Pix'),
    cash = forms.find((f) => f.nome === 'Dinheiro');
  await button('Consultar / editar Pix');
  await click('#forma-ativa');
  await fill('#forma-motivo', 'Inativar');
  await button('Salvar forma');
  await button('Confirmar');
  await until(`!document.querySelector('#forma-nome')`);
  assert.equal(
    (await api(`window.mnrApi.cadastros.formasPagamento.obter(${pix.id})`)).ativo,
    false,
  );
  await fill('mnr-formas-pagamento select', 'false');
  await until(`document.querySelector('mnr-formas-pagamento').innerText.includes('Pix')`);
  await button('Consultar / editar Pix');
  await click('#forma-ativa');
  await fill('#forma-motivo', 'Reativar');
  await button('Salvar forma');
  await button('Confirmar');
  await until(`!document.querySelector('#forma-nome')`);
  await button('Voltar à compra');
  await until(`!document.querySelector('mnr-formas-pagamento')`);
  await until(`!!document.querySelector('#compra-fornecedor option[value="${supplier.id}"]')`);
  await fill('#compra-fornecedor', String(supplier.id));
  await until(`!!document.querySelector('#compra-produto option[value="${p1.id}"]')`);
  await fill('#compra-produto', String(p1.id));
  await fill('#compra-produto', String(p2.id));
  await fill('#item-q-0', '3');
  await fill('#item-v-0', '1,01');
  await fill('#item-t-0', 'PONTOS_BASE');
  await fill('#item-d-0', '10');
  await fill('#item-v-1', '2,01');
  await fill('#compra-desconto', '0,01');
  await fill('#compra-frete', '0,05');
  await fill('#compra-despesas', '0,03');
  await fill('#compra-motivo', 'Compra UI');
  await click('nav a[href="#/dashboard"]');
  await until(
    `document.querySelector('mnr-confirm dialog[open]')?.innerText.includes('Sair da compra')`,
  );
  await key('Escape');
  await until(`!document.querySelector('mnr-confirm dialog[open]')`);
  assert.equal(await evaluate('location.hash'), '#/compras/nova');
  await button('Salvar rascunho');
  await until(
    `document.querySelector('mnr-compra-editor').innerText.includes('Total oficial: R$ 4,81')`,
  );
  await button('Adicionar pagamento');
  await fill('#pagamento-forma-0', String(pix.id));
  await fill('#pagamento-valor-0', '2,00');
  await button('Adicionar pagamento');
  await fill('#pagamento-forma-1', String(cash.id));
  await fill('#pagamento-valor-1', '2,81');
  await button('Salvar e revisar compra');
  await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
  const pageBefore = await api('window.mnrApi.compras.listar({})');
  const draft = await api(`window.mnrApi.compras.obter(${pageBefore.itens[0].id})`);
  const changed = {
    id: draft.id,
    versaoEsperada: draft.versao,
    fornecedorId: draft.fornecedorId,
    dataComercial: draft.dataComercial,
    itens: draft.itens.map((i) => ({
      produtoId: i.produtoId,
      quantidade: i.quantidade,
      valorUnitarioCentavos: i.valorUnitarioCentavos,
      desconto: { tipo: 'CENTAVOS', valor: i.descontoItemCentavos },
      motivo: i.motivo,
    })),
    descontoGlobal: { tipo: 'CENTAVOS', valor: draft.descontoGlobalCentavos },
    freteCentavos: draft.freteCentavos,
    despesasDiretasCentavos: draft.despesasDiretasCentavos,
    observacoes: draft.observacoes,
  };
  await api(`window.mnrApi.compras.salvarRascunho(${cmd(changed)})`);
  await button('Confirmar compra revisada');
  await button('Confirmar');
  await until(
    `document.querySelector('mnr-compra-editor').innerText.includes('Consultar versão atual preservando preenchimento')`,
  );
  await button('Consultar versão atual preservando preenchimento');
  await until(
    `!document.querySelector('mnr-compra-editor').innerText.includes('Consultar versão atual preservando preenchimento')`,
  );
  await button('Salvar e revisar compra');
  await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
  await fill('#compra-observacoes', 'alterado');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Revisão pronta"]')`), false);
  await button('Salvar e revisar compra');
  await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
  await capture('compras');
  const original = ipcMain._invokeHandlers.get('compras:confirmar'),
    commands = [];
  let lost = true;
  ipcMain.removeHandler('compras:confirmar');
  ipcMain.handle('compras:confirmar', async (...args) => {
    commands.push(JSON.stringify(args[1]));
    const r = await original(...args);
    if (r.ok && lost) {
      lost = false;
      throw Error('Test-only lost purchase reply');
    }
    return r;
  });
  await web.debugger.attach('1.3');
  await web.debugger.sendCommand('Network.enable');
  await web.debugger.sendCommand('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await button('Confirmar compra revisada');
  await button('Confirmar');
  await until(
    `document.querySelector('mnr-compra-editor').innerText.includes('Repetir o mesmo comando')`,
  );
  await button('Repetir o mesmo comando');
  await until(
    `document.querySelector('mnr-compra-editor').innerText.includes('Compra confirmada')`,
  );
  assert.equal(commands.length, 2);
  assert.equal(commands[0], commands[1]);
  const page = await api('window.mnrApi.compras.listar({})');
  assert.equal(page.itens.length, 1);
  const result = await api(`window.mnrApi.compras.obter(${page.itens[0].id})`);
  assert.equal(result.pagamentos.length, 2);
  assert.equal(result.totalCentavos, 481);
  assert.deepEqual(
    result.itens.map((i) => i.valorCustoEstoqueCentavos),
    [277, 204],
  );
  assert.equal((await api(`window.mnrApi.estoque.obter(${p1.id})`)).quantidade, 3);
  assert.equal((await api(`window.mnrApi.estoque.obter(${p2.id})`)).quantidade, 1);
  await button('Voltar às compras');
  await click('a[href="#/compras/nova"]');
  await fill('#compra-motivo', 'Descartar teste');
  await button('Salvar rascunho');
  await until(`document.querySelector('mnr-compra-editor').innerText.includes('Rascunho salvo')`);
  await button('Descartar rascunho');
  await button('Confirmar');
  await until(`document.querySelector('mnr-compra-editor').innerText.includes('DESCARTADO')`);
  const after = await api('window.mnrApi.compras.listar({})');
  assert.equal(after.itens.length, 2);
  assert.equal(after.itens[0].estado, 'DESCARTADO');
  assert.equal((await api(`window.mnrApi.estoque.obter(${p1.id})`)).quantidade, 3);
  ipcMain.removeHandler('compras:confirmar');
  ipcMain.handle('compras:confirmar', original);
  web.debugger.detach();
  console.log('COMPRAS_OFFLINE_IDEMPOTENCIA_OK');
}
