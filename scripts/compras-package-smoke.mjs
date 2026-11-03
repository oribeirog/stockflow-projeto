// External CDP automation of the unmodified packaged executable and its real ASAR.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { environment } from './env.mjs';
const root = resolve('.local-data/test');
mkdirSync(root, { recursive: true });
const isolated = mkdtempSync(resolve(root, 'compras-package-'));
const child = spawn(
  resolve('release/win-unpacked/MNR Perfumes.exe'),
  ['--remote-debugging-port=19229'],
  {
    cwd: isolated,
    env: environment({ LOCALAPPDATA: isolated, MNR_SMOKE: '0', MNR_DEV: '0', MNR_UI_TEST_RUN: '' }),
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
let socket;
try {
  let target;
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw Error('Executável encerrou antes de abrir.');
    try {
      target = (await (await fetch('http://127.0.0.1:19229/json/list')).json()).find(
        (t) => t.type === 'page' && t.url.startsWith('mnr://'),
      );
      if (target) break;
    } catch {
      /* Aguardando CDP. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw Error('A janela empacotada não disponibilizou depuração CDP.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    }
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression) => {
    for (let n = 0; n < 200; n++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error(
      'Timeout: ' +
        expression +
        '\n' +
        (await evaluate('document.querySelector("main")?.innerText')),
    );
  };
  const click = async (selector) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const button = async (label) => {
    const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await until(`!!(${expr})`);
    await evaluate(`${expr}.click()`);
  };
  const fill = async (selector, value) => {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
  };
  const api = async (expression) => {
    const value = await evaluate(expression);
    if (!value.ok) throw Error(JSON.stringify(value));
    return value.data;
  };
  const cmd = (data) =>
    `({operacaoId:crypto.randomUUID(),motivo:'Fixture pacote isolado',dados:${JSON.stringify(data)}})`;
  await until(`!!window.mnrApi && !!document.querySelector('nav')`);
  if ((await api('window.mnrApi.cadastros.formasPagamento.listar({})')).length !== 0)
    throw Error('Banco inicial possui formas.');
  const marca = await api(
    `window.mnrApi.cadastros.marcas.salvar(${cmd({ nome: 'Marca pacote' })})`,
  );
  const categoria = await api(
    `window.mnrApi.cadastros.categorias.salvar(${cmd({ nome: 'Categoria pacote' })})`,
  );
  const fornecedor = await api(
    `window.mnrApi.cadastros.fornecedores.salvar(${cmd({ nome: 'Fornecedor pacote' })})`,
  );
  const produto = await api(
    `window.mnrApi.cadastros.produtos.salvar(${cmd({ nome: 'Perfume pacote', sku: 'PACOTE', marcaId: marca.id, categoriaId: categoria.id, volumeMicrolitros: 1000, precoVendaCentavos: 0, estoqueMinimo: 0 })})`,
  );
  await click('nav a[href="#/compras"]');
  await click('a[href="#/compras/nova"]');
  await button('Gerenciar formas de pagamento');
  await button('Cadastrar forma');
  await fill('#forma-nome', 'Pix');
  await fill('#forma-motivo', 'Primeira forma');
  await button('Salvar forma');
  await button('Confirmar');
  await until(`!document.querySelector('#forma-nome')`);
  const forms = await api('window.mnrApi.cadastros.formasPagamento.listar({})');
  if (forms.length !== 1) throw Error('Primeira forma ausente.');
  await button('Voltar à compra');
  await until(`!!document.querySelector('#compra-fornecedor option[value="${fornecedor.id}"]')`);
  await fill('#compra-fornecedor', String(fornecedor.id));
  await until(`!!document.querySelector('#compra-produto option[value="${produto.id}"]')`);
  await fill('#compra-produto', String(produto.id));
  await fill('#item-q-0', '2');
  await fill('#item-v-0', '3,00');
  await fill('#compra-motivo', 'Compra pacote');
  await button('Salvar rascunho');
  await until(
    `document.querySelector('mnr-compra-editor').innerText.includes('Total oficial: R$ 6,00')`,
  );
  await button('Adicionar pagamento');
  await fill('#pagamento-forma-0', String(forms[0].id));
  await fill('#pagamento-valor-0', '6,00');
  await button('Salvar e revisar compra');
  await until(`!!document.querySelector('[aria-label="Revisão pronta"]')`);
  await call('Network.enable');
  await call('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await button('Confirmar compra revisada');
  await button('Confirmar');
  await until(
    `document.querySelector('mnr-compra-editor').innerText.includes('Compra confirmada')`,
  );
  const list = await api('window.mnrApi.compras.listar({})');
  const detail = await api(`window.mnrApi.compras.obter(${list.itens[0].id})`);
  if (
    list.itens.length !== 1 ||
    detail.pagamentos.length !== 1 ||
    detail.totalCentavos !== 600 ||
    (await api(`window.mnrApi.estoque.obter(${produto.id})`)).quantidade !== 2
  )
    throw Error('Efeitos da compra inconsistentes.');
  const idempotent = await evaluate(`(async()=>{
    const save={operacaoId:crypto.randomUUID(),motivo:'Idempotência pacote',dados:{fornecedorId:${fornecedor.id},dataComercial:${JSON.stringify(detail.dataComercial)},itens:[{produtoId:${produto.id},quantidade:1,valorUnitarioCentavos:100}]}};
    const a=await window.mnrApi.compras.salvarRascunho(save),b=await window.mnrApi.compras.salvarRascunho(save);
    if(!a.ok||!b.ok||JSON.stringify(a.data)!==JSON.stringify(b.data))throw Error('Repetição do rascunho falhou');
    const confirm={operacaoId:crypto.randomUUID(),motivo:'Idempotência pacote',dados:{id:a.data.id,versaoEsperada:a.data.versao,pagamentos:[{formaPagamentoId:${forms[0].id},valorCentavos:100}]}};
    const c=await window.mnrApi.compras.confirmar(confirm),d=await window.mnrApi.compras.confirmar(confirm);
    if(!c.ok||!d.ok||JSON.stringify(c.data)!==JSON.stringify(d.data))throw Error('Repetição da confirmação falhou');
    return {id:c.data.id};
  })()`);
  const repeated = await api(`window.mnrApi.compras.obter(${idempotent.id})`);
  const after = await api('window.mnrApi.compras.listar({})');
  if (
    after.itens.length !== 2 ||
    repeated.pagamentos.length !== 1 ||
    (await api(`window.mnrApi.estoque.obter(${produto.id})`)).quantidade !== 3
  )
    throw Error('Idempotência produziu efeitos duplicados.');
  console.log('COMPRAS_PACKAGED_OFFLINE_OK', isolated);
} finally {
  socket?.close();
  child.kill();
}
