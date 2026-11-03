import { app, BrowserWindow, protocol, net, session } from 'electron';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparePaths } from '../infrastructure/paths';
import { openDatabase } from '../infrastructure/database';
import { registerIpc } from '../ipc';
import { createFotoService } from '../services/fotos';
import { normalizeFoto } from '../services/foto-codec';
protocol.registerSchemesAsPrivileged([
  { scheme: 'mnr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const paths = preparePaths();
let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
const smoke = process.env['MNR_SMOKE'] === '1';
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      db = await openDatabase(paths.data, app.getVersion(), undefined, paths.images);
      const photos = createFotoService(db, paths.images, app.getVersion(), normalizeFoto);
      const imageHealth = await photos.reconcile();
      if (imageHealth.missing || imageHealth.preserved)
        console.warn('Fotografias: arquivos ausentes ou preservados para inspeção.', imageHealth);
      const dev = !app.isPackaged && process.env['MNR_DEV'] === '1';
      const url = dev ? 'http://127.0.0.1:4200/' : 'mnr://app/index.html';
      const root = resolve(__dirname, '../../renderer/browser');
      protocol.handle('mnr', (request) => {
        const parsed = new URL(request.url);
        const file = resolve(root, '.' + decodeURIComponent(parsed.pathname));
        const rel = relative(root, file);
        if (parsed.host !== 'app' || rel.startsWith('..') || isAbsolute(rel))
          return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).href);
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              dev
                ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:4200; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-src 'none'"
                : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-src 'none'",
            ],
          },
        });
      });
      const window = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 640,
        minHeight: 480,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, target) => {
        if (target.split('#')[0] !== url) event.preventDefault();
      });
      window.once('ready-to-show', () => window.show());
      registerIpc(window, db, url, photos);
      await window.loadURL(url);
      if (smoke) {
        if (!dev) {
          await window.webContents.debugger.attach('1.3');
          await window.webContents.debugger.sendCommand('Network.enable');
          await window.webContents.debugger.sendCommand('Network.emulateNetworkConditions', {
            offline: true,
            latency: 0,
            downloadThroughput: 0,
            uploadThroughput: 0,
          });
        }
        const result = await window.webContents.executeJavaScript(`(async () => {
      const result = await window.mnrApi.system.getStatus();
      if (!result.ok || result.data.database !== 'ready') throw new Error('IPC/SQLite failed');
      if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw new Error('Node exposed');
      if (!isSecureContext || typeof crypto.randomUUID !== 'function' || !/^[0-9a-f-]{36}$/.test(crypto.randomUUID())) throw new Error('Secure UUID unavailable');
      if (!document.querySelector('app-root h1')) throw new Error('Angular failed');
      document.querySelector('nav a[href="#/perfumes"]').click();
      for(let attempt=0;attempt<100;attempt++) {
        if(document.querySelector('mnr-perfumes') && !document.querySelector('mnr-perfumes .loading'))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(!document.querySelector('mnr-perfumes input[type=search]'))throw new Error('Offline perfumes route failed');
      const products = await window.mnrApi.cadastros.produtos.listar({limite:1});
      if(!products.ok)throw new Error('Offline perfume query failed');
      const until = async predicate => {
        for(let attempt=0;attempt<150;attempt++) {
          if(predicate()) return;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        throw new Error('People smoke timed out at ' + location.hash);
      };
      const fill = (id,value) => {
        const input=document.getElementById(id);
        input.value=value;
        input.dispatchEvent(new Event(input.tagName==='SELECT' ? 'change':'input',{bubbles:true}));
      };
      const button = async text => {
        await until(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===text && !b.disabled));
        const control=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text);
        if(!control || control.disabled)throw new Error('Unavailable button: '+text);
        control.click();
        await new Promise(resolve=>setTimeout(resolve,50));
      };
      const saved = () => document.querySelector('.feedback.success') && !document.querySelector('fieldset')?.disabled;
      for(const [path,singular] of [['clientes','cliente'],['fornecedores','fornecedor']]) {
        document.querySelector('nav a[href="#/'+path+'"]').click();
        await until(()=>document.querySelector('#pessoa-search'));
        fill('pessoa-search','vinculo');
        await until(()=>document.querySelectorAll('tbody tr').length===1);
        const api=window.mnrApi.cadastros[path];
        const linked=await api.listar({busca:'vinculo',limite:26});
        if(!linked.ok || linked.data.length!==1)throw new Error('Linked fixture missing');
        const person=linked.data[0];
        document.querySelector('a[href="#/'+path+'/'+person.id+'/editar"]').click();
        await until(()=>document.getElementById('pessoa-nome')?.value===person.nome);
        fill('pessoa-nome',person.nome+' editado');
        fill('pessoa-motivo','Smoke de edição com histórico vinculado');
        await button('Salvar '+singular);
        await until(saved);
        for(const active of [false,true]) {
          await button((active?'Reativar ':'Inativar ')+singular);
          await until(()=>document.querySelector('dialog[open]'));
          fill('confirm-reason','Smoke de situação com histórico vinculado');
          await button('Confirmar');
          await until(saved);
          const current=await api.obter(person.id);
          if(!current.ok || current.data.ativo!==active)throw new Error('Person status failed');
          for(const key of ['documento','telefone','email','endereco','observacoes'])
            if(current.data[key]!==person[key])throw new Error('Optional field lost: '+key);
        }
        document.querySelector('a[href="#/'+path+'"]').click();
        await until(()=>document.getElementById('pessoa-search'));
        document.querySelector('a[href="#/'+path+'/novo"]').click();
        await until(()=>document.getElementById('pessoa-nome'));
        fill('pessoa-nome','Smoke '+singular+' 4C');
        fill('pessoa-telefone','11 99999-3333');
        fill('pessoa-email','smoke@example.com');
        fill('pessoa-endereco','Endereço smoke');
        fill('pessoa-observacoes','Observação smoke');
        await button('Salvar '+singular);
        await until(()=>location.hash.endsWith('/editar') && saved() && document.getElementById('pessoa-nome'));
        const created=await api.listar({busca:'Smoke '+singular+' 4C',limite:26});
        if(!created.ok || created.data.length!==1 || created.data[0].documento!==null)throw new Error('Person create failed');
        fill('pessoa-telefone','');
        fill('pessoa-motivo','Limpeza explícita de telefone');
        await button('Salvar '+singular);
        await until(saved);
        const updated=await api.obter(created.data[0].id);
        if(!updated.ok || updated.data.telefone!==null || updated.data.email!=='smoke@example.com' || updated.data.endereco!=='Endereço smoke' || updated.data.observacoes!=='Observação smoke')throw new Error('Person full replacement failed');
      }
      document.querySelector('nav a[href="#/estoque"]').click();
      await until(()=>document.getElementById('estoque-search'));
      const stockList=await window.mnrApi.estoque.listar({limite:1,ativo:true});
      if(!stockList.ok || !stockList.data.itens.length)throw new Error('Offline stock query failed');
      const stockProduct=stockList.data.itens[0];
      const filter=document.getElementById('estoque-search');
      fill('estoque-search',stockProduct.sku);
      filter.form.requestSubmit();
      await until(()=>document.querySelector('a[href="#/estoque/'+stockProduct.produtoId+'"]'));
      document.querySelector('a[href="#/estoque/'+stockProduct.produtoId+'"]').click();
      await until(()=>document.querySelector('mnr-estoque-detalhe .summary'));
      await button('Contagem física');
      await until(()=>document.getElementById('estoque-quantidade'));
      fill('estoque-quantidade',String(stockProduct.quantidade));
      fill('estoque-motivo','Smoke de contagem sem diferença');
      await button('Revisar operação');
      await until(()=>document.querySelector('dialog[open]'));
      await button('Confirmar');
      await until(()=>document.querySelector('.feedback.success')?.textContent.includes('sem movimentação'));
      return result;
    })()`);
        console.log('SMOKE_OK', JSON.stringify(result));
        console.log(dev ? 'PERFUMES_DEVELOPMENT_OK' : 'PERFUMES_OFFLINE_OK');
        console.log(dev ? 'PESSOAS_DEVELOPMENT_OK' : 'PESSOAS_OFFLINE_OK');
        console.log(dev ? 'ESTOQUE_DEVELOPMENT_OK' : 'ESTOQUE_OFFLINE_OK');
        app.quit();
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => db?.close());
