// Runs the real desktop entry point without changing its production behavior.
// Uses the normal development database; never deletes data or changes its schema.
const { app, ipcMain } = require('electron');
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
  const web = window.webContents;
  const evaluate = (expression) => web.executeJavaScript(expression);
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
    if (!['dashboard', 'configuracoes'].includes(path)) {
      await until(
        `document.querySelector('main').textContent.includes('Disponível em uma próxima etapa')`,
      );
    }
  }
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
  await noOverflow();
  web.debugger.detach();
  console.log(
    'Validated: nine routes, title/selection/focus, reload/history/fallback, diagnostic success/error/loading/retry, native keyboard, component actions, offline custom protocol, 3 sizes × 3 zoom levels, expanded sidebar, isolation.',
  );
}
