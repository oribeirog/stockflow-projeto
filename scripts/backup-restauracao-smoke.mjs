// Real application, native-dialog responses controlled only by this external harness.
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
import { connect, pause } from './exportacoes-cdp.mjs';
import { catalogScenario } from './catalogo-generalista-scenario.mjs';
import { fotosScenario } from './fotos-scenario.mjs';
import { auditCheckpoint } from './consolidacao-gerencial-scenario.mjs';
const require = createRequire(import.meta.url),
  { backupFixture } = require('../tests/helpers/backup-fixture.cjs'),
  { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs'),
  {
    selection,
    selectedPaths,
    recoveryPaths,
    newOwnedSet,
  } = require('../dist/electron/services/backup/control'),
  { coletarDocumento } = require('../dist/electron/services/exportacoes/documento'),
  { readArchive, inspectArchive } = require('../dist/electron/services/backup/format'),
  Database = require('better-sqlite3');
const catalogo = process.argv.includes('--catalogo-generalista');
const legacyMode = process.argv.includes('--legacy-schema5');
const internetMode = process.argv.includes('--fotos-internet');
const photosMode = internetMode || process.argv.includes('--fotos');
const legacy6Mode = process.argv.includes('--legacy-schema6');
const legacy = legacyMode
  ? await require('../tests/helpers/catalogo-v5-fixture.cjs').legacyFixture()
  : legacy6Mode
    ? await require('../tests/helpers/approved-v6.cjs').legacyFixture6()
    : undefined;
// Compare every pre-0006 persisted field and migration record against the genuine
// approved archive. The new unit defaults and migration-6 record are checked separately.
const snapshotComplete = snapshot;
const comparable = (value) =>
  JSON.stringify(
    JSON.parse(value).map(([name, rows]) => [
      name,
      rows
        .filter((r) => name !== 'schema_migrations' || r.versao <= 5)
        .map((r) => {
          const x = { ...r };
          if (name === 'produtos') delete x.unidade_comercial;
          if (name === 'itens_documento') delete x.unidade_historica;
          return x;
        }),
    ]),
  );
const stateSnapshot = (db) =>
  legacyMode ? comparable(snapshotComplete(db)) : snapshotComplete(db);
const packaged = process.argv.includes('--package'),
  supervised = process.argv.includes('--supervised-development'),
  development = supervised || process.argv.includes('--development'),
  mode = supervised ? 'dev-supervisor' : packaged ? 'package' : development ? 'http' : 'local';
assert(!(packaged && development));
mkdirSync('.local-data/test', { recursive: true });
mkdirSync('.cache/ui', { recursive: true });
const launchRoot = mkdtempSync(resolve('.local-data/test/ui-backup-')),
  root = packaged ? join(launchRoot, 'MNR Software/MNR Perfumes') : launchRoot;
mkdirSync(root, { recursive: true });
const f = legacyMode
    ? await require('../tests/helpers/catalogo-v5-fixture.cjs').legacyUiFixture(root)
    : photosMode || legacy6Mode
      ? await require('../tests/helpers/approved-v6.cjs').legacyProfile6(root)
      : await backupFixture(undefined, true, { root }),
  initialSnapshot = stateSnapshot(f.db),
  initialSequences = f.db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
  archive = join(f.outputs, 'MNR Teste + @.mnrbackup'),
  manifest = [],
  measurements = [];
let before = initialSnapshot,
  sequencesA = initialSequences,
  catalogAudit,
  photoAudit;
let server,
  child,
  main,
  renderer,
  db = f.db,
  serial = 0,
  restoredSnapshot;
let captureWindowId;
const env = environment({
  MNR_SMOKE: '0',
  MNR_DEV: development ? '1' : '0',
  MNR_UI_TEST_RUN: packaged ? '' : basename(root),
  ...(packaged ? { LOCALAPPDATA: launchRoot } : {}),
});
const spawnApp = () =>
  spawn(
    supervised
      ? process.execPath
      : packaged
        ? resolve('release/win-unpacked/MNR Gestao.exe')
        : electron,
    [
      ...(supervised ? ['scripts/dev.mjs'] : packaged ? [] : ['.']),
      '--inspect=19268',
      '--remote-debugging-port=19269',
    ],
    { cwd: packaged ? launchRoot : process.cwd(), env, stdio: ['ignore', 'ignore', 'inherit'] },
  );
let e,
  m,
  call,
  ownsMain = false;
let evaluationId = 0;
async function syncMain(connection, expression) {
  const r = await connection.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function attach(current) {
  ownsMain = false;
  main = await connect(19268, () => true, current);
  console.log('BACKUP_STEP', mode, 'main-connected');
  let observedRoot = '';
  for (let n = 0; n < 500; n++) {
    try {
      observedRoot = String(
        await syncMain(main, `process.mainModule.require('electron').app.getPath('userData')`),
      );
      if (resolve(observedRoot).toLowerCase() === resolve(root).toLowerCase()) break;
    } catch {
      /* Main module is still initializing. */
    }
    await pause(20);
  }
  assert.equal(resolve(observedRoot).toLowerCase(), resolve(root).toLowerCase());
  ownsMain = true;
  console.log('BACKUP_STEP', mode, 'root-verified');
  renderer = await connect(
    19269,
    (t) =>
      t.type === 'page' && t.url.startsWith(development ? 'http://127.0.0.1:4200' : 'mnr://app'),
    current,
  );
  const evaluate = renderer.evaluate;
  e = async (expression) => {
    const id = ++evaluationId;
    try {
      return await evaluate(
        `(()=>{globalThis.__backupPending??=Object.create(null);return globalThis.__backupPending[${id}]=Promise.resolve(${expression});})()`,
      );
    } catch (error) {
      throw Error('Renderer evaluation ' + expression.slice(0, 180) + ': ' + error.message);
    } finally {
      await evaluate(`delete globalThis.__backupPending?.[${id}]`).catch(() => undefined);
    }
  };
  m = (expression) => syncMain(main, expression);
  call = renderer.call;
  await call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await m(
    `globalThis.__e=process.mainModule.require('electron');__e.BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false));globalThis.__save=[];globalThis.__open=[];__e.dialog.showSaveDialog=async()=>{const p=__save.shift();return {canceled:!p,filePath:p};};__e.dialog.showOpenDialog=async()=>{const p=__open.shift();return {canceled:!p,filePaths:p?[p]:[]};};globalThis.__metrics=[];(()=>{const j=process.mainModule.require(__e.app.getAppPath()+'/dist/electron/services/backup/jobs.js'),original=j.backupJob;j.backupJob=async task=>{const start=performance.now();try{const result=await original(task);__metrics.push({task:task.task,ms:performance.now()-start,rss:process.memoryUsage().rss,captureMs:result.captureMs,photoMs:result.photoMs});return result;}catch(error){__metrics.push({task:task.task,failed:true});throw error;}}})()`,
  );
  if (packaged) {
    await call('Network.enable');
    await call('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
  }
  await until('!!window.mnrApi?.backup && !!document.querySelector("nav")');
  const baseUrl = (await e('location.href')).split('#')[0];
  const uiWindows = await m(
    `__e.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&w.webContents.getURL().split('#')[0]===${JSON.stringify(baseUrl)}).map(w=>w.id)`,
  );
  assert.equal(uiWindows.length, 1, 'Capture must target the connected application window');
  captureWindowId = uiWindows[0];
  assert.equal(await e('typeof require'), 'undefined');
  assert.equal(await e('typeof process'), 'undefined');
  console.log('BACKUP_STEP', mode, 'attached', await m('process.pid'));
}
async function until(expr) {
  for (let n = 0; n < 1500; n++) {
    if (await e(expr)) return;
    await pause(20);
  }
  throw Error(
    'BACKUP UI timeout ' + expr + '\n' + (await e('document.querySelector("main")?.innerText')),
  );
}
async function click(text) {
  const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.matches(':disabled'))`;
  await until(`!!(${expr})`);
  await e(`${expr}.click()`);
  await pause(30);
}
async function key(key, modifiers = 0) {
  const code = key === 'Tab' ? 9 : key === 'Enter' ? 13 : 27;
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    windowsVirtualKeyCode: code,
    modifiers,
    ...(key === 'Enter' ? { text: '\r' } : {}),
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: key,
    windowsVirtualKeyCode: code,
    modifiers,
  });
  await pause(40);
}
async function capture(label) {
  for (const [width, height] of [
    [1366, 768],
    [1000, 700],
    [640, 480],
  ])
    for (const zoom of [1, 1.25, 1.5]) {
      // The native capture surface must fit the emulated viewport. Otherwise a
      // 1366px viewport on the original 1000px window yields white padded crops.
      await m(
        `(()=>{const w=__e.BrowserWindow.fromId(${captureWindowId});if(!w||w.isDestroyed())throw Error('Connected application window is unavailable');if(w.isMinimized())w.restore();w.show();w.setContentSize(${width},${height});})()`,
      );
      await call('Emulation.setDeviceMetricsOverride', {
        width: Math.round(width / zoom),
        height: Math.round(height / zoom),
        deviceScaleFactor: zoom,
        mobile: false,
      });
      await pause(80);
      await e(
        `document.getElementById(${JSON.stringify(label === 'revisao' ? 'backup-review-title' : label === 'restaurado' ? 'backup-last-result' : 'backup-message')})?.scrollIntoView({block:'start'})`,
      );
      assert(
        await e('document.documentElement.scrollWidth<=innerWidth'),
        `${mode} ${label} ${width} ${zoom}`,
      );
      if (zoom === 1 || width === 640) {
        await call('Page.bringToFront');
        let r;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            r = await call('Page.captureScreenshot', {
              format: 'png',
              captureBeyondViewport: false,
              fromSurface: false,
            });
            break;
          } catch (error) {
            console.error(
              'CAPTURE_ATTEMPT_FAILED',
              mode,
              label,
              width,
              zoom,
              attempt,
              error.message,
            );
            if (attempt === 3 || !error.message.includes('Unable to capture screenshot'))
              throw error;
            await call('Page.bringToFront');
            await pause(150);
          }
        }
        assert(r?.data, 'A real screenshot remains mandatory');
        writeFileSync(
          `.cache/ui/${photosMode ? 'pre52b-fotos-backup' : legacy6Mode ? 'pre52b-legacy6-backup' : 'backup'}-${mode}-${label}-${width}-${zoom}.png`,
          Buffer.from(r.data, 'base64'),
        );
      }
    }
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await m(`__e.BrowserWindow.fromId(${captureWindowId}).setContentSize(1366,768)`);
}
async function navBackup() {
  await e(`location.hash='#/configuracoes'`);
  await until(`!!document.querySelector('a[href="#/configuracoes/backup"]')`);
  await e(`document.querySelector('a[href="#/configuracoes/backup"]').click()`);
  await until('!!document.getElementById("backup-title")');
}
async function stopApp() {
  try {
    if (ownsMain)
      await syncMain(main, `setTimeout(()=>process.mainModule.require('electron').app.quit(),100)`);
  } catch {
    /* shutdown */
  }
  main?.close();
  renderer?.close();
  ownsMain = false;
  let closed = 0;
  for (let n = 0; n < 300; n++) {
    let open = false;
    for (const port of [19268, 19269])
      try {
        await fetch(`http://127.0.0.1:${port}/json/list`);
        open = true;
      } catch {
        /* closed */
      }
    closed = open ? 0 : closed + 1;
    if (closed >= 5 && (!supervised || child.exitCode !== null)) return;
    await pause(50);
  }
  throw Error('App debugging ports did not close');
}
async function generate(model, format, label, filtros) {
  const path = join(f.outputs, `${++serial}-${label}-${model}.${format}`);
  await m(`__save.push(${JSON.stringify(path)})`);
  const r = await e(
    `window.mnrApi.exportacoes.${format === 'xlsx' ? 'exportarExcel' : 'exportarPdf'}(${JSON.stringify({ modelo: model, filtros })})`,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.cancelado, false);
  manifest.push({
    path,
    documento: coletarDocumento(db, { modelo: model, filtros }, () => new Date(r.data.geradoEm)),
  });
}
try {
  for (const port of [19268, 19269]) {
    let occupied = false;
    try {
      await fetch(`http://127.0.0.1:${port}/json/list`);
      occupied = true;
    } catch {
      /*free*/
    }
    assert(!occupied, 'Test port already occupied; preserving the existing process');
  }
  if (development && !supervised) {
    server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
      env: environment(),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    let ready = false;
    for (let n = 0; n < 150; n++) {
      if (server.exitCode !== null) throw Error('HTTP ended');
      try {
        if ((await fetch('http://127.0.0.1:4200')).ok) {
          ready = true;
          break;
        }
      } catch {
        /*startup*/
      }
      await pause(400);
    }
    assert(ready);
  }
  child = spawnApp();
  await attach(child);
  let oldPid = await m('process.pid');
  if (photosMode || legacy6Mode) {
    assert.equal(await m('__e.app.getName()'), 'MNR Gestão');
    assert(!/[^\x20-\x7e]/.test(await m('__e.app.userAgentFallback')));
    const selected = selectedPaths(root, await selection(root));
    assert.equal(resolve(selected.data), resolve(f.data));
    assert.equal(stateSnapshot(db), initialSnapshot);
    assert(!existsSync(join(launchRoot, 'MNR Software/MNR Gestão')));
    assert(!existsSync(join(launchRoot, 'MNR Gestão')));
  }
  if (photosMode) {
    if (internetMode)
      await m(
        `(()=>{const original=__e.dialog.showOpenDialog;__e.dialog.showOpenDialog=async(...args)=>{const options=args.at(-1);if(options.filters?.[0]?.extensions?.includes('webp'))globalThis.__lastPhotoFilter=options.filters[0].extensions;return original(...args)}})()`,
      );
    photoAudit = await fotosScenario({
      e,
      m,
      until,
      click,
      key,
      call,
      mode,
      productData: f.cycle.productData,
      db,
      internet: internetMode,
    });
    before = stateSnapshot(db);
    sequencesA = db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
    if (internetMode) {
      await stopApp();
      child = spawnApp();
      await attach(child);
      assert.notEqual(await m('process.pid'), oldPid);
      oldPid = await m('process.pid');
      assert.equal(stateSnapshot(db), before);
      for (const p of photoAudit.internetProducts) {
        const restored = await e(
          `window.mnrApi.fotos.obter({produtoId:${p.id},variante:'imagem'}).then(r=>({ok:r.ok,bytes:r.ok?Array.from(r.data.bytes):null}))`,
        );
        const { createHash } = await import('node:crypto');
        assert(restored.ok);
        assert.equal(
          createHash('sha256').update(Buffer.from(restored.bytes)).digest('hex'),
          p.hash,
        );
      }
      photoAudit.reopenedBeforeBackup = true;
    }
  }
  if (catalogo) {
    catalogAudit = await catalogScenario({ e, until, click, key, call, m, mode });
    before = stateSnapshot(db);
    sequencesA = db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  }
  await navBackup();
  console.log('BACKUP_STEP', mode, 'route');
  await key('Tab');
  await key('Tab', 8);
  assert(await e('!!document.activeElement'));
  await click('Criar backup');
  await until('document.getElementById("backup-message")?.innerText.includes("cancelada")');
  assert.equal(stateSnapshot(db), before);
  assert(!existsSync(archive));
  await until('document.activeElement.closest("mnr-button")?.id === "backup-create"');
  await m(`__save.push(${JSON.stringify(archive)})`);
  const createdAt = performance.now();
  await click('Criar backup');
  await e(`document.querySelector('#backup-create button').click()`);
  await until('document.getElementById("backup-message")?.innerText.includes("Backup concluído")');
  const createMs = performance.now() - createdAt;
  assert(existsSync(archive));
  assert.equal(stateSnapshot(db), before);
  await readArchive(archive);
  console.log('BACKUP_STEP', mode, 'archive-created');
  await capture('sucesso');
  const change = f.cycle.stockCommand({
    produtoId: f.cycle.manual.id,
    quantidade: 2,
    custoTotalCentavos: 17,
  });
  assert.equal(
    (await e(`window.mnrApi.estoque.registrarEntrada(${JSON.stringify(change)})`)).ok,
    true,
  );
  const remove = f.command({ produtoId: f.cycle.productId });
  assert.equal((await e(`window.mnrApi.fotos.remover(${JSON.stringify(remove)})`)).ok, true);
  if (photoAudit)
    for (const p of photoAudit.products)
      assert.equal(
        (await e(`window.mnrApi.fotos.remover(${JSON.stringify(f.command({ produtoId: p.id }))})`))
          .ok,
        true,
      );
  const exclusiveB = f.command({
    ...f.cycle.productData,
    sku: 'BACKUP-B-ONLY',
    nome: 'Produto exclusivo do estado B',
  });
  assert.equal(
    (await e(`window.mnrApi.cadastros.produtos.salvar(${JSON.stringify(exclusiveB)})`)).ok,
    true,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM produtos WHERE sku='BACKUP-B-ONLY'").get().n, 1);
  const changed = stateSnapshot(db);
  const sequencesB = db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
  console.log('BACKUP_STEP', mode, 'data-changed');
  assert.notEqual(changed, before);
  await click('Selecionar backup para revisão');
  await until('document.getElementById("backup-message")?.innerText.includes("Seleção cancelada")');
  assert.equal(stateSnapshot(db), changed);
  await m(`__open.push(${JSON.stringify(legacy?.archive ?? archive)})`);
  await click('Selecionar backup para revisão');
  await until('!!document.getElementById("backup-review-title")');
  assert.equal(stateSnapshot(db), changed);
  await until('document.activeElement.id === "backup-review-title"');
  await capture('revisao');
  console.log('BACKUP_STEP', mode, 'preview');
  await click('Descartar revisão');
  await until('!document.getElementById("backup-review-title")');
  assert.equal(stateSnapshot(db), changed);
  await m(`__open.push(${JSON.stringify(legacy?.archive ?? archive)})`);
  await click('Selecionar backup para revisão');
  await until('!!document.getElementById("backup-ack")');
  assert(await e('document.querySelector("#backup-restore button").matches(":disabled")'));
  await e('document.getElementById("backup-ack").click()');
  await click('Restaurar este backup');
  await until('!!document.querySelector("dialog[open]")');
  await key('Escape');
  await until('!document.querySelector("dialog[open]")');
  assert.equal(stateSnapshot(db), changed);
  await until('document.activeElement.closest("mnr-button")?.id === "backup-restore"');
  await click('Restaurar este backup');
  await until('!!document.querySelector("dialog[open]")');
  measurements.push(...(await m('__metrics')));
  db.close();
  const restartAt = performance.now();
  const oldInspector = (await (await fetch('http://127.0.0.1:19268/json/list')).json())[0].id;
  console.log('BACKUP_STEP', mode, 'confirming-restore');
  await click('Confirmar');
  for (let n = 0; n < 1000; n++) {
    try {
      const r = await e('window.mnrApi.backup.estado()');
      if (r.ok && r.data.fase.startsWith('Reiniciando')) break;
    } catch {
      break;
    }
    await pause(20);
  }
  main.close();
  renderer.close();
  if (!supervised && child.exitCode === null)
    await Promise.race([
      new Promise((r) => child.once('exit', r)),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('Old process did not exit')), 30000),
      ),
    ]);
  if (supervised) {
    let changedInspector = false;
    for (let n = 0; n < 500; n++) {
      try {
        const targets = await (await fetch('http://127.0.0.1:19268/json/list')).json();
        if (targets[0]?.id && targets[0].id !== oldInspector) {
          changedInspector = true;
          break;
        }
      } catch {
        /* gap between children */
      }
      await pause(50);
    }
    assert(changedInspector, 'Development supervisor did not relaunch its child');
    assert.equal(child.exitCode, null, 'Development supervisor exited during restore');
    assert((await fetch('http://127.0.0.1:4200/')).ok);
  } else assert.equal(child.exitCode, 0);
  await attach({ exitCode: null });
  const newPid = await m('process.pid');
  assert.notEqual(newPid, oldPid);
  await until('document.getElementById("backup-last-result")?.innerText.includes("concluída")');
  const reopenMs = performance.now() - restartAt;
  console.log('BACKUP_STEP', mode, 'actual-relaunch', oldPid, newPid);
  const state = await e('window.mnrApi.backup.estado()');
  assert.equal(state.ok, true);
  assert.equal(state.data.resultado.situacao, 'restaurado');
  assert.equal(state.data.bloqueado, false);
  if (legacyMode) {
    before = comparable(legacy.stateA);
    sequencesA = legacy.sequencesA;
  }
  if (legacy6Mode) {
    before = legacy.stateA;
    sequencesA = legacy.sequencesA;
  }
  const paths = selectedPaths(root, await selection(root));
  db = new Database(join(paths.data, 'mnr-perfumes.db'), { readonly: true, fileMustExist: true });
  assert.equal(stateSnapshot(db), before);
  assert.equal(db.prepare("SELECT count(*) n FROM produtos WHERE sku='BACKUP-B-ONLY'").get().n, 0);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(), sequencesA);
  assert(!existsSync(recoveryPaths(root).pending));
  const activeId = await selection(root);
  assert.equal(activeId, state.data.resultado.protecao.replace('.mnrbackup', ''));
  assert.equal(
    JSON.parse(readFileSync(join(recoveryPaths(root).plans, activeId + '.done.json'))).status,
    'restaurado',
  );
  const proofRoot = mkdtempSync(resolve('.local-data/test/backup-protection-proof-')),
    proof = await newOwnedSet(proofRoot, 'work');
  await inspectArchive(
    join(recoveryPaths(root).protection, state.data.resultado.protecao),
    proof.path,
  );
  const preservedB = new Database(join(proof.path, 'data/mnr-perfumes.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.equal(stateSnapshot(preservedB), changed);
    assert.deepEqual(
      preservedB.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
      sequencesB,
    );
    assert.equal(
      preservedB.prepare("SELECT count(*) n FROM produtos WHERE sku='BACKUP-B-ONLY'").get().n,
      1,
    );
  } finally {
    preservedB.close();
  }
  assert.equal(db.pragma('user_version', { simple: true }), 6);
  if (legacyMode) {
    assert.equal(
      db.prepare("SELECT count(*) n FROM produtos WHERE unidade_comercial<>'UN'").get().n,
      0,
    );
    assert.equal(
      (await require('../dist/electron/services/backup/io').hashFile(legacy.archive)).sha256,
      legacy.archiveSha256,
    );
  }
  if (legacy6Mode)
    assert.equal(
      (await require('../dist/electron/services/backup/io').hashFile(legacy.archive)).sha256,
      legacy.archiveSha256,
    );
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  const image = await e(
    `window.mnrApi.fotos.obter({produtoId:${f.cycle.productId},variante:'imagem'}).then(r=>({ok:r.ok,bytes:r.ok?Array.from(r.data.bytes):null}))`,
  );
  assert.equal(image.ok, true);
  assert.deepEqual(Buffer.from(image.bytes), f.png);
  if (photoAudit)
    for (const p of photoAudit.products) {
      if (p.large) {
        const { createHash } = await import('node:crypto');
        const row = db
          .prepare(
            'SELECT a.* FROM foto_arquivos a JOIN produto_fotos p ON a.id=p.foto_id WHERE p.produto_id=?',
          )
          .get(p.id);
        assert.equal(row.hash, p.hash);
        assert.equal(
          createHash('sha256')
            .update(readFileSync(join(paths.images, 'objects', row.id + '.image')))
            .digest('hex'),
          p.hash,
        );
        continue;
      }
      const r = await e(
        `window.mnrApi.fotos.obter({produtoId:${p.id},variante:'imagem'}).then(r=>({ok:r.ok,bytes:r.ok?Array.from(r.data.bytes):null}))`,
      );
      assert(r.ok);
      const { createHash } = await import('node:crypto');
      assert.equal(createHash('sha256').update(Buffer.from(r.bytes)).digest('hex'), p.hash);
    }
  await capture('restaurado');
  const audit = await auditCheckpoint({
    e,
    until,
    generate,
    manifest,
    label: 'restaurado',
    filter: { dataInicio: '2026-11-01', dataFim: '2026-11-30', clienteId: f.cycle.clienteId },
    saleId: f.cycle.state.sale.id,
    expected: { commercial: 30000, debt: 5000, pending: 0, paid: 0 },
  });
  assert.equal(stateSnapshot(db), before);
  db.close();
  await stopApp();
  child = spawnApp();
  await attach(child);
  db = new Database(join(paths.data, 'mnr-perfumes.db'), { readonly: true, fileMustExist: true });
  assert.equal(stateSnapshot(db), before, 'SECOND opening must still be exactly A');
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(), sequencesA);
  assert.equal(db.prepare("SELECT count(*) n FROM produtos WHERE sku='BACKUP-B-ONLY'").get().n, 0);
  const next = f.cycle.stockCommand({
    produtoId: f.cycle.manual.id,
    quantidade: 1,
    custoTotalCentavos: 1,
  });
  assert.equal(
    (await e(`window.mnrApi.estoque.registrarEntrada(${JSON.stringify(next)})`)).ok,
    true,
  );
  restoredSnapshot = stateSnapshot(db);
  assert.notEqual(restoredSnapshot, before);
  db.close();
  await stopApp();
  assert.equal(
    readdirSync(join(root, 'logs')).filter((n) => n.startsWith('startup-error-')).length,
    0,
  );
  child = spawnApp();
  await attach(child);
  db = new Database(join(paths.data, 'mnr-perfumes.db'), { readonly: true, fileMustExist: true });
  assert.equal(stateSnapshot(db), restoredSnapshot);
  await generate('ESTOQUE', 'xlsx', 'terceira-abertura', {});
  await generate('ESTOQUE', 'pdf', 'terceira-abertura', {});
  assert.equal(stateSnapshot(db), restoredSnapshot);
  db.close();
  await stopApp();
  const manifestPath = join(f.outputs, 'exports.json');
  assert.equal(
    readdirSync(join(root, 'logs')).filter((n) => n.startsWith('startup-error-')).length,
    0,
  );
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const python =
    process.env.MNR_TEST_PYTHON ??
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const checked = spawnSync(python, ['scripts/verify-exportacoes.py', manifestPath], {
    stdio: 'inherit',
  });
  assert.equal(checked.status, 0);
  const report = {
    mode,
    root,
    outputs: f.outputs,
    archive,
    bytes: statSync(archive).size,
    createMs,
    reopenMs,
    measurements,
    catalogAudit,
    photoAudit,
    legacySchema5: legacyMode,
    audit,
    exports: manifest.length,
    manifest: manifestPath,
    processes: { oldPid, newPid },
    protection: state.data.resultado.protecao,
    states: {
      firstAutomaticOpening: 'A',
      secondManualOpening: 'A',
      exclusiveBAbsent: true,
      protectionExactlyB: true,
      pendingAbsent: true,
      activeId,
      startupErrors: 0,
    },
  };
  writeFileSync(
    `.cache/${internetMode ? 'pre52b-internet' : photosMode ? 'pre52b-fotos' : legacy6Mode ? 'pre52b-legacy6' : legacyMode ? 'pre52a-legacy' : catalogo ? 'pre52a-catalogo' : '5-1'}-${mode}-smoke.json`,
    JSON.stringify(report, null, 2),
  );
  assert(existsSync(join(recoveryPaths(root).protection, report.protection)));
  console.log('BACKUP_RESTORE_RELAUNCH_AND_SECOND_REOPEN_OK', mode, report.exports, root);
} finally {
  if (db?.open) db.close();
  try {
    await stopApp();
  } catch {
    /* already closed */
  }
  child?.kill();
  try {
    const target = await fetch('http://127.0.0.1:19268/json/list');
    if (target.ok) {
      const leftover = await connect(19268, () => true, { exitCode: null });
      if (
        resolve(
          await leftover.evaluate(`process.mainModule.require('electron').app.getPath('userData')`),
        ).toLowerCase() === resolve(root).toLowerCase()
      )
        await leftover.evaluate(
          `setTimeout(()=>process.mainModule.require('electron').app.exit(0),50)`,
        );
      leftover.close();
    }
  } catch {
    /* no owned process */
  }
  server?.kill();
}
