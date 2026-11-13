import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
import { connect, pause } from './exportacoes-cdp.mjs';
const require = createRequire(import.meta.url);
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { seedComprasCorrecoes } = require('../tests/helpers/correcoes-compras-fixture.cjs');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const packaged = process.argv.includes('--package'),
  development = process.argv.includes('--development');
assert(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
mkdirSync('.cache/ui', { recursive: true });
const root = mkdtempSync(resolve('.local-data/test/ui-correcoes-compras-'));
const directory = packaged ? join(root, 'MNR Software/MNR Perfumes/data') : join(root, 'data');
mkdirSync(directory, { recursive: true });
const db = await openDatabase(directory, 'test'),
  s = seedComprasCorrecoes(db),
  purchase = s.purchase();
const cancellable = s.purchase(3, 300, {
  itens: [{ produtoId: s.second.id, quantidade: 3, valorUnitarioCentavos: 300 }],
  freteCentavos: 20,
});
const consumed = s.purchase(1, 2000);
s.sale(1);
const { cmd: fixtureCommand } = require('../tests/helpers/correcoes-compras-fixture.cjs');
const concurrentProduct = s.catalog.saveProduct(
  fixtureCommand({
    ...s.productData,
    sku: 'CC-CONCURRENT',
    nome: 'Item consumido durante a revisão',
  }),
);
const remainingProduct = s.catalog.saveProduct(
  fixtureCommand({ ...s.productData, sku: 'CC-REMAINING', nome: 'Item restante da compra' }),
);
const multi = s.purchase(1, 100, {
  itens: [
    { produtoId: concurrentProduct.id, quantidade: 2, valorUnitarioCentavos: 100 },
    { produtoId: remainingProduct.id, quantidade: 2, valorUnitarioCentavos: 100 },
  ],
});
// Historical identities must survive inactive current catalogs.
const { cmd } = require('../tests/helpers/correcoes-compras-fixture.cjs');
s.catalog.saveProduct(
  cmd({ ...s.productData, id: s.product.id, nome: 'Nome atual diferente', ativo: false }),
);
s.catalog.savePerson(
  'FORNECEDOR',
  cmd({ id: s.supplier.id, nome: 'Fornecedor atual diferente', ativo: false }),
);
let server;
try {
  if (development) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: environment(),
    });
    let ready = false;
    for (let n = 0; n < 120; n++) {
      if (server.exitCode !== null) throw Error('Servidor encerrou');
      try {
        if ((await fetch('http://127.0.0.1:4200')).ok) {
          ready = true;
          break;
        }
      } catch {
        /*startup*/
      }
      await pause(500);
    }
    assert(ready, 'HTTP indisponível');
  }
  if (!packaged) {
    mkdirSync('.cache/correcoes-compras-app', { recursive: true });
    writeFileSync(
      '.cache/correcoes-compras-app/package.json',
      JSON.stringify({
        name: 'mnr-correcoes-compras-test',
        version: '0.1.0',
        main: '../../scripts/correcoes-compras-host.cjs',
      }),
    );
  }
  let persisted;
  for (const reopen of [false, true]) {
    const child = spawn(
      packaged ? resolve('release/win-unpacked/MNR Perfumes.exe') : electron,
      [...(packaged ? [] : ['.cache/correcoes-compras-app']), '--remote-debugging-port=19239'],
      {
        cwd: packaged ? root : process.cwd(),
        stdio: ['ignore', 'ignore', 'inherit'],
        env: environment({
          MNR_SMOKE: '0',
          MNR_DEV: development ? '1' : '0',
          MNR_UI_TEST_RUN: packaged ? '' : basename(root),
          ...(packaged ? { LOCALAPPDATA: root } : {}),
        }),
      },
    );
    let c;
    const timer = setTimeout(() => child.kill(), 180000);
    try {
      c = await connect(
        19239,
        (t) =>
          t.type === 'page' &&
          t.url.startsWith(development ? 'http://127.0.0.1:4200' : 'mnr://app'),
        child,
      );
      const { evaluate: e, call } = c;
      await call('Emulation.setFocusEmulationEnabled', { enabled: true });
      const until = async (expr) => {
        for (let n = 0; n < 200; n++) {
          if (await e(expr)) return;
          await pause(30);
        }
        throw Error(
          'Timeout ' + expr + '\n' + (await e('document.querySelector("main")?.innerText')),
        );
      };
      const click = async (label) => {
        const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
        await until(`!!(${expr})`);
        await e(`${expr}.click()`);
        await pause(40);
      };
      const fill = async (id, value) => {
        await e(
          `(()=>{const x=document.getElementById(${JSON.stringify(id)});x.value=${JSON.stringify(value)};x.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await pause(30);
      };
      const nav = async (path) => {
        await e(`location.hash=${JSON.stringify('#/' + path)}`);
        await pause(100);
      };
      const api = async (method, input) => {
        const r = await e(`window.mnrApi.correcoesCompras.${method}(${JSON.stringify(input)})`);
        assert.equal(r.ok, true, JSON.stringify(r));
        return r.data;
      };
      if (packaged) {
        await call('Network.enable');
        await call('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
      }
      await until('!!window.mnrApi?.correcoesCompras&&!!document.querySelector("nav")');
      assert.equal(await e('typeof require'), 'undefined');
      assert.equal(await e('typeof process'), 'undefined');
      if (reopen) {
        assert.equal(snapshot(db), persisted);
        const before = snapshot(db),
          ctx = await api('obterContexto', purchase.id);
        assert.equal(ctx.itens[0].quantidadeRestante, 0);
        assert.equal((await api('obterContexto', cancellable.id)).compra.estado, 'ESTORNADO');
        await nav(`compras/${purchase.id}/correcoes`);
        await until('document.querySelector("main").innerText.includes("DEV_COMPRA")');
        assert.equal(snapshot(db), before);
        console.log('CORRECOES_COMPRAS_REOPEN_OK', root);
        continue;
      }
      const capture = async (name) => {
        for (const [width, height] of [
          [1366, 768],
          [1000, 700],
          [640, 480],
        ])
          for (const zoom of [1, 1.25, 1.5]) {
            await call('Emulation.setDeviceMetricsOverride', {
              width: Math.round(width / zoom),
              height: Math.round(height / zoom),
              deviceScaleFactor: zoom,
              mobile: false,
            });
            await pause(80);
            assert.equal(
              await e('document.documentElement.scrollWidth<=innerWidth'),
              true,
              `${name} ${width} ${zoom}`,
            );
            // Capture representative sizes; all nine combinations have overflow/focus checks.
            if (zoom === 1 || width === 640) {
              await call('Page.bringToFront');
              await e(
                `document.querySelector(${JSON.stringify(name === 'revisao' || name === 'cancelamento' ? '#correcao-revisao' : name === 'resultado' ? '[aria-label="Correção concluída"]' : '.table-wrap')})?.scrollIntoView({block:'start'})`,
              );
              await pause(100);
              const img = await call('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
              });
              writeFileSync(
                resolve(
                  `.cache/ui/correcoes-compras-${packaged ? 'offline' : development ? 'http' : 'local'}-${name}-${width}-${zoom}.png`,
                ),
                Buffer.from(img.data, 'base64'),
              );
            }
          }
        await call('Emulation.setDeviceMetricsOverride', {
          width: 1000,
          height: 700,
          deviceScaleFactor: 1,
          mobile: false,
        });
      };
      await nav(`compras/${purchase.id}`);
      await until(`!!document.querySelector('a[href="#/compras/${purchase.id}/correcoes"]')`);
      await e(`document.querySelector('a[href="#/compras/${purchase.id}/correcoes"]').click()`);
      await until(`!!document.querySelector('a[href="#/compras/${purchase.id}/devolver"]')`);
      await e(`document.querySelector('a[href="#/compras/${purchase.id}/devolver"]').click()`);
      await until(
        '!!document.getElementById("correcao-data")&&!document.getElementById("correcao-data").disabled',
      );
      assert(
        (await e('document.querySelector("main").innerText')).includes(
          'Fornecedor histórico São João',
        ),
      );
      await fill('correcao-motivo', 'Devolução ao fornecedor por solicitação');
      await click('Preencher todas as quantidades disponíveis');
      await fill('correcao-q-' + purchase.itens[0].id, '11');
      await click('Revisar efeitos oficiais');
      await until(
        `document.getElementById('correcao-q-${purchase.itens[0].id}').getAttribute('aria-invalid')==='true'`,
      );
      await fill('correcao-q-' + purchase.itens[0].id, '2');
      await until(`!!document.querySelector('#correcao-forma option[value="${s.form.id}"]')`);
      await e(
        `(()=>{const x=document.getElementById('correcao-forma');x.value='${s.form.id}';x.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await fill('correcao-pagamento-0', '40,00');
      await capture('formulario');
      await click('Revisar efeitos oficiais');
      await until('!!document.getElementById("correcao-revisao")');
      await capture('revisao');
      // A changed reason invalidates the review without losing form values.
      await fill('correcao-motivo', 'Devolução revisada ao fornecedor');
      assert.equal(await e('!!document.getElementById("correcao-revisao")'), false);
      await click('Revisar efeitos oficiais');
      await until('!!document.getElementById("correcao-confirmar")');
      await e(`document.querySelector('#correcao-confirmar button').focus()`);
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
      });
      assert.equal(await e('document.activeElement!==document.body'), true);
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        modifiers: 8,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        modifiers: 8,
      });
      await e(`document.querySelector('#correcao-confirmar button').focus()`);
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        windowsVirtualKeyCode: 13,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await until('!!document.querySelector("dialog[open]")');
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await until('!document.querySelector("dialog[open]")');
      assert.equal(
        await e(`document.activeElement===document.querySelector('#correcao-confirmar button')`),
        true,
      );
      await click('Confirmar correção revisada');
      if (!packaged) writeFileSync(join(root, 'fault.json'), JSON.stringify({ mode: 'lost' }));
      // Double click must still send just one intent.
      await e(
        `(()=>{const b=Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='Confirmar');b.click();b.click();})()`,
      );
      if (!packaged) {
        await until(
          'document.querySelector("main").innerText.includes("Repetir a mesma intenção")',
        );
        assert.equal(
          await e('document.getElementById("correcao-data").matches(":disabled")'),
          true,
        );
        await nav('dashboard');
        assert.equal(await e('location.hash'), `#/compras/${purchase.id}/devolver`);
        await click('Repetir a mesma intenção');
        const commands = readFileSync(join(root, 'commands.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse);
        assert.equal(commands.length, 2);
        assert.deepEqual(commands[0], commands[1]);
      }
      await until("document.querySelector('main').innerText.includes('Correção confirmada')");
      assert.equal((await api('obterContexto', purchase.id)).itens[0].quantidadeDevolvida, 2);
      await capture('resultado');
      await click('Nova devolução');
      await fill('correcao-motivo', 'Restante devolvido com reembolso integral');
      await click('Preencher todas as quantidades disponíveis');
      await e(
        `(()=>{const x=document.getElementById('correcao-forma');x.value='${s.form.id}';x.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await fill('correcao-pagamento-0', '160,00');
      await click('Revisar efeitos oficiais');
      await until('!!document.getElementById("correcao-confirmar")');
      await click('Confirmar correção revisada');
      if (!packaged) writeFileSync(join(root, 'fault.json'), JSON.stringify({ mode: 'read' }));
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('Correção confirmada')");
      if (!packaged) {
        await until('document.querySelector("main").innerText.includes("Falhou somente")');
        await click('Consultar novamente preservando campos');
        await until('!document.querySelector("[role=alert]")');
      }
      const ctx = await api('obterContexto', purchase.id);
      assert.equal(ctx.itens[0].quantidadeDisponivel, 0);
      assert.equal(ctx.cancelavel, false);
      await nav(`compras/${purchase.id}/correcoes`);
      await until('document.querySelector("main").innerText.includes("DEV_COMPRA")');
      assert.equal(
        await e(`!!document.querySelector('a[href="#/compras/${purchase.id}/cancelar"]')`),
        false,
      );
      const docs = await api('listarDocumentos', { compraId: purchase.id });
      assert.equal(docs.itens.length, 2);
      await click('Consultar documento #' + docs.itens[0].id);
      await until('!!document.getElementById("compra-correcao-documento")');
      assert(
        (await e('document.getElementById("compra-correcao-documento").innerText')).includes(
          'REEMBOLSO_FORNECEDOR',
        ),
      );
      await nav(`compras/${cancellable.id}/cancelar`);
      await until('!!document.getElementById("correcao-motivo")');
      await fill('correcao-motivo', 'Cancelamento integral elegível');
      await click('Revisar efeitos oficiais');
      await until('!!document.getElementById("correcao-revisao")');
      await capture('cancelamento');
      await click('Confirmar correção revisada');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('Correção confirmada')");
      assert.equal((await api('obterContexto', cancellable.id)).compra.estado, 'ESTORNADO');
      await nav(`compras/${multi.id}/devolver`);
      await until('!!document.getElementById("correcao-motivo")');
      await fill('correcao-motivo', 'Revisão concorrente com preservação dos campos');
      await click('Preencher todas as quantidades disponíveis');
      await until(`!!document.querySelector('#correcao-forma option[value="${s.form.id}"]')`);
      await e(
        `(()=>{const x=document.getElementById('correcao-forma');x.value='${s.form.id}';x.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await fill('correcao-pagamento-0', '4,00');
      await click('Revisar efeitos oficiais');
      await until('!!document.getElementById("correcao-confirmar")');
      // A real sale on the second connection consumes one selected product after review.
      const draft = s.commercial.salvarRascunho(
        cmd({
          tipo: 'VENDA',
          modalidadeVenda: 'A_VISTA',
          dataComercial: '2026-11-12',
          itens: [{ produtoId: concurrentProduct.id, quantidade: 2, valorUnitarioCentavos: 100 }],
        }),
      );
      s.commercial.confirmar(
        cmd({
          id: draft.id,
          versaoEsperada: draft.versao,
          pagamentos: [{ formaPagamentoId: s.form.id, valorCentavos: draft.totalCentavos }],
        }),
      );
      await click('Confirmar correção revisada');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('mudaram')");
      assert.equal(await e('document.getElementById("correcao-pagamento-0").value'), '4,00');
      await click('Consultar novamente preservando campos');
      const itemId = multi.itens.find((i) => i.produtoId === concurrentProduct.id).id;
      await until(
        `!!document.querySelector('input[aria-label="Devolver Item consumido durante a revisão"]')&&!document.querySelector('input[aria-label="Devolver Item consumido durante a revisão"]').matches(':disabled')`,
      );
      assert.equal(await e(`document.getElementById('correcao-q-${itemId}').value`), '2');
      await e(
        `document.querySelector('input[aria-label="Devolver Item consumido durante a revisão"]').click()`,
      );
      await fill('correcao-pagamento-0', '2,00');
      await click('Revisar efeitos oficiais');
      await until('!!document.getElementById("correcao-confirmar")');
      await click('Confirmar correção revisada');
      await click('Confirmar');
      await until("document.querySelector('main').innerText.includes('Correção confirmada')");
      const corrected = await api('obterContexto', multi.id);
      assert.equal(
        corrected.itens.find((i) => i.produtoId === concurrentProduct.id).quantidadeDevolvida,
        0,
      );
      assert.equal(
        corrected.itens.find((i) => i.produtoId === remainingProduct.id).quantidadeDevolvida,
        2,
      );
      await nav(`compras/${consumed.id}/correcoes`);
      await until("document.querySelector('main').innerText.includes('movimentação posterior')");
      assert.equal(
        await e(`!!document.querySelector('a[href="#/compras/${consumed.id}/cancelar"]')`),
        false,
      );
      assert.equal(
        db.prepare('SELECT quantidade FROM saldos_estoque WHERE produto_id=?').get(s.product.id)
          .quantidade,
        0,
      );
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
      persisted = snapshot(db);
      writeFileSync(join(root, 'final-snapshot.json'), persisted);
      console.log(
        'CORRECOES_COMPRAS_UI_OK',
        packaged ? 'package-offline' : development ? 'http' : 'mnr',
        root,
      );
    } finally {
      clearTimeout(timer);
      c?.close();
      child.kill();
      if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
    }
  }
} finally {
  server?.kill();
  db.close();
}
