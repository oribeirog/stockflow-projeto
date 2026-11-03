// Runs the real desktop entry point without changing its production behavior.
// Each run uses its own database, images and Chromium directory.
const { app, ipcMain, dialog, nativeImage } = require('electron');
const { strict: assert } = require('node:assert');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void verify(window).then(
      () => {
        console.log('DESKTOP_UI_OK');
        app.quit();
      },
      (error) => {
        console.error(error);
        app.exit(1);
      },
    );
  });
});
require('../dist/electron/main/index.js');

async function verify(window) {
  assert.match(app.getPath('userData'), /[\\/]test[\\/]ui-[a-zA-Z0-9_-]+$/);
  assert.equal(app.getPath('sessionData'), resolve(app.getPath('userData'), 'chromium'));
  const web = window.webContents;
  const evaluate = async (expression) => {
    try {
      return await web.executeJavaScript(expression);
    } catch (error) {
      throw new Error('Renderer expression failed: ' + expression + '\n' + error);
    }
  };
  web.on('console-message', (event) => {
    if (event.level === 'error') console.error('Renderer:', event.message);
  });
  async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await pause(50);
    }
    throw new Error('Timed out: ' + expression);
  }
  async function click(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await pause(80);
  }
  async function route(path, title) {
    await click(`nav a[href="#/${path}"]`);
    await until(
      `document.querySelector('h1').textContent === ${JSON.stringify(title)} && document.activeElement === document.querySelector('h1')`,
    );
    assert.equal(await evaluate('document.title'), `${title} • MNR Perfumes`);
    assert.equal(await evaluate('document.querySelectorAll("nav [aria-current=page]").length'), 1);
    assert.equal(
      await evaluate('document.querySelector("nav [aria-current=page]").getAttribute("href")'),
      `#/${path}`,
    );
  }
  async function noOverflow() {
    const overflow = await evaluate(`(() => {
      const elements = [document.documentElement, document.querySelector('main'), document.querySelector('header'), ...document.querySelectorAll('main section, main mnr-card')];
      return elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({tag: el.tagName, class: el.className, width: el.clientWidth, scroll: el.scrollWidth}));
    })()`);
    if (overflow.length) await screenshot('overflow');
    assert.deepEqual(
      overflow,
      [],
      'Horizontal overflow at ' +
        (await evaluate(
          'innerWidth + "px, expanded=" + document.querySelector(".shell").className',
        )),
    );
  }
  async function screenshot(name) {
    await pause(100);
    writeFileSync(resolve('.cache/ui', name + '.png'), (await web.capturePage()).toPNG());
  }
  async function key(keyCode, modifiers = []) {
    window.focus();
    web.focus();
    await pause(20);
    web.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') web.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    web.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(40);
  }
  mkdirSync(resolve('.cache/ui'), { recursive: true });
  await until(`document.querySelector('mnr-dashboard') !== null`);
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector("main > mnr-dashboard > .stack")).display',
    ),
    'grid',
    'Global stylesheet must load under the production CSP',
  );
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  assert.equal(await evaluate('typeof window.process'), 'undefined');
  assert.equal(web.getLastWebPreferences().sandbox, true);
  assert.equal(web.getLastWebPreferences().contextIsolation, true);
  assert.equal(web.getLastWebPreferences().nodeIntegration, false);
  const destinations = [
    ['dashboard', 'Dashboard'],
    ['perfumes', 'Perfumes'],
    ['estoque', 'Estoque'],
    ['vendas', 'Vendas'],
    ['compras', 'Compras'],
    ['clientes', 'Clientes'],
    ['fornecedores', 'Fornecedores'],
    ['relatorios', 'Relatórios'],
    ['configuracoes', 'Configurações'],
  ];
  for (const [path, title] of destinations) {
    await route(path, title);
    if (!['dashboard', 'configuracoes', 'perfumes'].includes(path)) {
      await until(
        `document.querySelector('main').textContent.includes('Disponível em uma próxima etapa')`,
      );
    }
  }
  await route('perfumes', 'Perfumes');
  await until(
    `document.querySelector('mnr-perfumes')?.textContent.includes('Nenhum perfume encontrado')`,
  );
  await route('configuracoes', 'Configurações');
  console.log('Diagnostic URL:', await evaluate('location.href'));
  await until(
    `document.querySelector('main').textContent.includes('Electron e SQLite conectados.')`,
  );
  web.reload();
  await until(
    `document.querySelector('main')?.textContent.includes('Electron e SQLite conectados.')`,
  );
  assert.equal(await evaluate('location.hash'), '#/configuracoes');
  await screenshot('settings');
  // Simulate diagnostic failure and a delayed retry only in this test process.
  ipcMain.removeHandler('system:get-status');
  ipcMain.handle('system:get-status', () => ({
    ok: false,
    error: { code: 'TEST', message: 'Falha simulada pelo teste desktop.' },
  }));
  await click('mnr-settings mnr-button button');
  await until(`document.querySelector('[role=alert]')?.textContent.includes('Falha simulada')`);
  let finishRetry;
  ipcMain.removeHandler('system:get-status');
  ipcMain.handle(
    'system:get-status',
    () =>
      new Promise((resolveRetry) => {
        finishRetry = resolveRetry;
      }),
  );
  await click('mnr-settings mnr-content-state button');
  await until(`document.querySelector('mnr-settings .loading') !== null`);
  assert.equal(await evaluate('document.querySelector("mnr-settings button").disabled'), true);
  finishRetry({ ok: true, data: { version: 'teste', database: 'ready' } });
  await until(
    `document.querySelector('main').textContent.includes('Electron e SQLite conectados.')`,
  );
  await route('dashboard', 'Dashboard');
  await evaluate(
    `(() => { window.__liveBlobs = new Set(); const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL); URL.createObjectURL = blob => { const url=create(blob); window.__liveBlobs.add(url); return url; }; URL.revokeObjectURL = url => { window.__liveBlobs.delete(url); revoke(url); }; })()`,
  );
  // Real UI writes, exclusively inside this run's isolated database.
  await route('perfumes', 'Perfumes');
  await click('a[href="#/perfumes/novo"]');
  await until(`document.querySelector('mnr-perfume-editor') !== null`);
  async function fill(selector, value) {
    await evaluate(
      `(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  }
  async function buttonText(text) {
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`,
    );
    await pause(80);
  }
  await buttonText('Salvar perfume');
  await until(`document.activeElement.id === 'perfume-nome'`);
  assert.equal(
    await evaluate(`document.querySelector('#perfume-nome').getAttribute('aria-invalid')`),
    'true',
  );
  await screenshot('perfume-validation');
  await fill('#perfume-nome', 'Perfume interface');
  await fill('#perfume-sku', 'UI-001');
  await fill('#perfume-volume', '100,125');
  await fill('#perfume-preco', '129,90');
  for (const [kind, name] of [
    ['marca', 'Marca UI'],
    ['categoria', 'Categoria UI'],
  ]) {
    await click(`mnr-reference-picker[kind="${kind}"] summary`);
    await fill(`#${kind}-new`, name);
    await click(`mnr-reference-picker[kind="${kind}"] mnr-button button`);
    await until(`document.querySelector('#${kind}-select').value !== ''`);
  }
  const photoPath = resolve(app.getPath('userData'), 'selected-photo.png');
  writeFileSync(
    photoPath,
    nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 255), { width: 4, height: 4 }).toPNG(),
  );
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [photoPath] });
  await buttonText('Selecionar fotografia');
  await until(`document.querySelector('img[alt="Prévia da fotografia selecionada"]') !== null`);
  const productHandler = ipcMain._invokeHandlers.get('cadastros:produtos:salvar');
  const productCommands = [];
  let loseProductReply = true;
  ipcMain.removeHandler('cadastros:produtos:salvar');
  ipcMain.handle('cadastros:produtos:salvar', async (...args) => {
    productCommands.push(JSON.stringify(args[1]));
    const result = await productHandler(...args);
    if (loseProductReply && result.ok) {
      loseProductReply = false;
      throw new Error('Test-only lost product reply after commit');
    }
    return result;
  });
  await evaluate(
    `(() => { const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Salvar perfume'); button.click(); button.click(); })()`,
  );
  await until(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Tentar confirmar novamente')`,
  );
  assert.equal(await evaluate(`document.querySelector('fieldset').disabled`), true);
  await buttonText('Tentar confirmar novamente');
  assert.equal(productCommands.length, 2);
  assert.equal(productCommands[0], productCommands[1]);
  await until(
    `document.querySelector('.feedback.success')?.textContent.includes('Perfume e fotografia salvos')`,
  );
  await until(`document.querySelector('mnr-photo-editor mnr-photo img') !== null`);
  assert.equal(await evaluate(`document.querySelector('#perfume-sku').readOnly`), true);
  assert.equal(await evaluate(`document.querySelector('#perfume-volume').value`), '100,125');
  await screenshot('perfume-created');
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  await buttonText('Selecionar fotografia');
  assert.equal(
    await evaluate(
      `document.querySelector('img[alt="Prévia da fotografia selecionada"]') !== null`,
    ),
    false,
  );
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [photoPath] });
  await buttonText('Selecionar fotografia');
  await until(`document.querySelector('img[alt="Prévia da fotografia selecionada"]') !== null`);
  await fill('#perfume-motivo', 'Inclusão da fotografia');
  const originalPhotoHandler = ipcMain._invokeHandlers.get('fotos:salvar');
  let losePhotoReply = true;
  ipcMain.removeHandler('fotos:salvar');
  ipcMain.handle('fotos:salvar', async (...args) => {
    const reply = await originalPhotoHandler(...args);
    if (losePhotoReply && reply.ok) {
      losePhotoReply = false;
      throw new Error('Test-only lost photo reply after commit');
    }
    return reply;
  });
  await buttonText('Salvar perfume');
  await until(
    `document.querySelector('mnr-photo-editor')?.textContent.includes('Tentar confirmar fotografia novamente')`,
  );
  await screenshot('perfume-photo-partial');
  await buttonText('Tentar confirmar fotografia novamente');
  await until(
    `document.querySelector('mnr-photo-editor')?.textContent.includes('Fotografia atualizada com sucesso')`,
  );
  await until(`document.querySelector('mnr-photo-editor mnr-photo img') !== null`);
  await click('mnr-photo-editor .thumbnail');
  await until(`document.querySelector('dialog[open] img.large') !== null`);
  await key('Escape');
  await until(`document.querySelector('dialog[open]') === null`);
  for (const [width, height] of [
    [1366, 768],
    [1000, 700],
    [640, 480],
  ]) {
    window.setSize(width, height);
    for (const zoom of [1, 1.25, 1.5]) {
      web.setZoomFactor(zoom);
      await pause(100);
      await noOverflow();
      await screenshot(`perfume-editor-${width}-${height}-${zoom}`);
      await evaluate(`document.querySelector('mnr-photo-editor').scrollIntoView({block:'start'})`);
      await screenshot(`perfume-editor-photo-${width}-${height}-${zoom}`);
      await evaluate(`document.querySelector('main').scrollTop=0; window.scrollTo(0,0)`);
    }
  }
  window.setSize(1000, 700);
  web.setZoomFactor(1);
  await fill('#perfume-nome', 'Perfume editado');
  await click('a[href="#/perfumes"]');
  await until(
    `document.querySelector('dialog[open] #confirm-title')?.textContent === 'Descartar alterações?'`,
  );
  await key('Escape');
  await until(`document.querySelector('dialog[open]') === null`);
  assert.equal(await evaluate(`document.querySelector('#perfume-nome').value`), 'Perfume editado');
  await fill('#perfume-motivo', 'Correção do nome');
  await buttonText('Salvar perfume');
  await until(`document.querySelector('.feedback.success') !== null`);
  await buttonText('Inativar perfume');
  await until(`document.querySelector('dialog[open]') !== null`);
  await fill('#confirm-reason', 'Saiu de linha');
  await buttonText('Confirmar');
  await until(
    `Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Reativar perfume'))`,
  );
  await buttonText('Reativar perfume');
  await until(`document.querySelector('dialog[open]') !== null`);
  await fill('#confirm-reason', 'Retorno ao catálogo');
  await buttonText('Confirmar');
  await until(
    `Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Inativar perfume'))`,
  );
  const Database = require('better-sqlite3');
  const inspection = new Database(resolve(app.getPath('userData'), 'data/mnr-perfumes.db'));
  const saved = inspection.prepare("SELECT * FROM produtos WHERE sku='UI-001'").get();
  assert.equal(saved.volume_microlitros, 100125);
  assert.equal(saved.preco_venda_centavos, 12990);
  assert.equal(saved.ativo, 1);
  assert.equal(inspection.prepare('SELECT count(*) n FROM produtos').get().n, 1);
  assert.equal(inspection.prepare('SELECT count(*) n FROM historico_precos').get().n, 1);
  assert.equal(inspection.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 0);
  const { createCatalogService } = require('../dist/electron/services/catalogos.js');
  const { randomUUID } = require('node:crypto');
  const catalogs = createCatalogService(inspection, 'ui');
  for (let index = 0; index < 26; index++)
    catalogs.saveProduct({
      operacaoId: randomUUID(),
      motivo: 'Paginação UI',
      dados: {
        nome: `Teste ${String(index).padStart(2, '0')}`,
        sku: `PAGE-${index}`,
        marcaId: saved.marca_id,
        categoriaId: saved.categoria_id,
        volumeMicrolitros: 1000,
        precoVendaCentavos: 0,
        estoqueMinimo: 0,
      },
    });
  const otherId = inspection.prepare("SELECT id FROM produtos WHERE sku='PAGE-0'").get().id;
  inspection.close();
  const photoHandler = ipcMain._invokeHandlers.get('fotos:obter'),
    photoReads = [];
  ipcMain.removeHandler('fotos:obter');
  ipcMain.handle('fotos:obter', (...args) => {
    photoReads.push(args[1]);
    return photoHandler(...args);
  });
  await click('a[href="#/perfumes"]');
  await until(`document.querySelectorAll('tbody tr').length === 25`);
  await until(`document.querySelectorAll('mnr-photo').length === 25`);
  assert.equal(photoReads.length, 25);
  assert.ok(photoReads.every((r) => r.variante === 'miniatura'));
  await buttonText('Próxima');
  await until(`document.querySelectorAll('tbody tr').length === 2`);
  await fill('#perfume-search', 'UI-001');
  await until(`document.querySelectorAll('tbody tr').length === 1`);
  assert.equal(
    await evaluate(`document.querySelector('.pagination [role=status]').textContent`),
    'Página 1',
  );
  await screenshot('perfume-search');
  for (const [width, height] of [
    [1366, 768],
    [1000, 700],
    [640, 480],
  ]) {
    window.setSize(width, height);
    for (const zoom of [1, 1.25, 1.5]) {
      web.setZoomFactor(zoom);
      await pause(100);
      await noOverflow();
      await screenshot(`perfume-list-${width}-${height}-${zoom}`);
      await evaluate(`document.querySelector('tbody tr').scrollIntoView({block:'start'})`);
      await screenshot(`perfume-list-row-${width}-${height}-${zoom}`);
      await evaluate(`document.querySelector('main').scrollTop=0; window.scrollTo(0,0)`);
    }
  }
  window.setSize(1000, 700);
  web.setZoomFactor(1);
  await click('tbody a[aria-label="Editar Perfume editado"]');
  await until(`document.querySelector('#perfume-sku')?.value === 'UI-001'`);
  await evaluate(`location.hash='/perfumes/${otherId}/editar'`);
  await until(`document.querySelector('#perfume-sku')?.value === 'PAGE-0'`);
  await fill('#perfume-nome', 'Rascunho não salvo');
  await evaluate(`location.hash='/perfumes/${saved.id}/editar'`);
  await until(
    `document.querySelector('dialog[open] #confirm-title')?.textContent === 'Descartar alterações?'`,
  );
  await key('Escape');
  await until(`location.hash === '#/perfumes/${otherId}/editar'`);
  assert.equal(await evaluate(`document.querySelector('#perfume-sku').value`), 'PAGE-0');
  await click('a[href="#/perfumes"]');
  await until(`document.querySelector('dialog[open]') !== null`);
  await buttonText('Confirmar');
  await until(`document.querySelector('mnr-perfumes') !== null`);
  await route('dashboard', 'Dashboard');
  assert.equal(
    await evaluate('window.__liveBlobs.size'),
    0,
    'All photo object URLs must be released after leaving the feature',
  );
  await route('perfumes', 'Perfumes');
  await evaluate('history.back()');
  await until(`document.querySelector('h1').textContent === 'Dashboard'`);
  await evaluate('history.forward()');
  await until(`document.querySelector('h1').textContent === 'Perfumes'`);
  await evaluate(`location.hash = '/rota-inexistente'`);
  await until(
    `location.hash === '#/dashboard' && document.querySelector('mnr-dashboard') !== null`,
  );

  for (const [width, height] of [
    [1366, 768],
    [1000, 700],
    [640, 480],
  ]) {
    window.setSize(width, height);
    for (const zoom of [1, 1.25, 1.5]) {
      web.setZoomFactor(zoom);
      await pause(150);
      await noOverflow();
      const compact = await evaluate('innerWidth < 900');
      if (compact) {
        await click('.menu-toggle');
        assert.equal(
          await evaluate('document.querySelector(".menu-toggle").getAttribute("aria-expanded")'),
          'true',
        );
        await noOverflow();
        await screenshot(`dashboard-${width}-${height}-${zoom}-expanded`);
        await click('.sidebar-toggle');
      }
      await screenshot(`dashboard-${width}-${height}-${zoom}`);
    }
  }
  window.setSize(1000, 700);
  web.setZoomFactor(1);
  window.show();
  window.focus();
  window.setSize(640, 480);
  await pause(100);
  await evaluate(`document.querySelector('.menu-toggle').focus()`);
  await key('Enter');
  await until(`document.activeElement.classList.contains('sidebar-toggle')`);
  await key('Escape');
  await until(
    `document.activeElement.classList.contains('menu-toggle') && document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'false'`,
  );
  window.setSize(1000, 700);
  await pause(100);
  // Traverse all sidebar destinations using native Tab and Enter events.
  await evaluate(`document.querySelector('.skip-link').focus()`);
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.className'), 'brand');
  await key('Tab');
  for (const [path, title] of destinations) {
    assert.equal(await evaluate('document.activeElement.getAttribute("href")'), `#/${path}`);
    await key('Enter');
    await until(`document.querySelector('h1').textContent === ${JSON.stringify(title)}`);
    // Return through the skip link to reach the next destination by Tab.
    await evaluate(`document.querySelector('.skip-link').focus()`);
    const index = destinations.findIndex(([entry]) => entry === path);
    for (let tab = 0; tab < index + 3; tab++) await key('Tab');
  }
  await route('dashboard', 'Dashboard');
  await click('mnr-dashboard mnr-button button');
  await until(`document.querySelector('main').textContent.includes('Exemplo executado.')`);
  await evaluate(
    `document.querySelector('#demo-name').value = 'Exemplo'; document.querySelector('#demo-name').dispatchEvent(new Event('input', { bubbles: true }))`,
  );
  await pause(80);
  await click('mnr-dashboard mnr-button:nth-of-type(2) button');
  assert.equal(await evaluate('document.querySelector("#demo-name").value'), '');
  assert.equal(await evaluate('document.querySelector("#demo-disabled").disabled'), true);
  assert.equal(
    await evaluate('document.querySelectorAll("mnr-dashboard mnr-content-state").length'),
    3,
  );
  assert.equal(
    await evaluate(
      'document.querySelector("mnr-dashboard mnr-button:last-child button:disabled") !== null',
    ),
    true,
  );
  // Disabled controls are skipped, field has its native label, and focus remains visible.
  await evaluate(`document.querySelector('#demo-name').focus()`);
  assert.equal(
    await evaluate('document.querySelector("#demo-name").labels[0].textContent'),
    'Nome de exemplo',
  );
  await key('Tab');
  assert.notEqual(await evaluate('document.activeElement.id'), 'demo-disabled');
  await evaluate(`document.querySelector('#components-title').scrollIntoView()`);
  await screenshot('components-actions');
  await evaluate(
    `document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight`,
  );
  await screenshot('components-states');
  assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
  // Reload Dashboard and visit a lazy module while emulating offline network conditions.
  await web.debugger.attach('1.3');
  await web.debugger.sendCommand('Network.enable');
  await web.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  assert.equal(
    await evaluate('getComputedStyle(document.querySelector("nav a")).transitionDuration'),
    '0s',
  );
  await web.debugger.sendCommand('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  web.reload();
  await until(`document.querySelector('mnr-dashboard') !== null`);
  await route('estoque', 'Estoque');
  await route('perfumes', 'Perfumes');
  await fill('#perfume-search', 'UI-001');
  await until(
    `document.querySelectorAll('tbody tr').length === 1 && document.querySelector('mnr-photo .thumbnail') !== null`,
  );
  await click('mnr-photo .thumbnail');
  await until(`document.querySelector('dialog[open] img.large') !== null`);
  await screenshot('perfume-offline-photo');
  await key('Escape');
  await noOverflow();
  web.debugger.detach();
  console.log(
    'Validated: nine routes, title/selection/focus, reload/history/fallback, diagnostic success/error/loading/retry, native keyboard, component actions, offline custom protocol, 3 sizes × 3 zoom levels, expanded sidebar, isolation.',
  );
}
