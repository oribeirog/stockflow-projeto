// Renderer + IPC + DOM latency over isolated copies of the validated 4F1 checkpoints.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { release, cpus } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
import { connect, pause } from './exportacoes-cdp.mjs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
const checkpoints = JSON.parse(readFileSync('.cache/benchmark-relatorios.json', 'utf8'));
const result = {
  createdAt: new Date().toISOString(),
  os: release(),
  cpu: cpus()[0].model,
  node: process.version,
  samples: [],
};
mkdirSync('.local-data/test', { recursive: true });
for (const volume of [50, 200, 500]) {
  const source = resolve(
    checkpoints.samples.find((s) => s.vendas === volume).checkpoint,
    'mnr-perfumes.db',
  );
  const rel = relative(resolve('.local-data/test'), source);
  assert(!rel.startsWith('..') && !isAbsolute(rel));
  const original = new Database(source, { readonly: true, fileMustExist: true });
  original.pragma('query_only=ON');
  const sourceBefore = snapshot(original);
  const root = mkdtempSync(resolve('.local-data/test/ui-gerencial-benchmark-'));
  mkdirSync(join(root, 'data'));
  const bytes = original.serialize();
  assert(bytes.length <= 50 * 1024 * 1024);
  writeFileSync(join(root, 'data/mnr-perfumes.db'), bytes);
  assert.equal(snapshot(original), sourceBefore);
  original.close();
  const db = new Database(join(root, 'data/mnr-perfumes.db'), {
    readonly: true,
    fileMustExist: true,
  });
  const before = snapshot(db);
  const child = spawn(electron, ['.', '--inspect=19245', '--remote-debugging-port=19246'], {
    env: environment({ MNR_SMOKE: '0', MNR_DEV: '0', MNR_UI_TEST_RUN: basename(root) }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const timer = setTimeout(() => child.kill(), 120000);
  let main, renderer;
  try {
    main = await connect(19245, () => true, child);
    renderer = await connect(
      19246,
      (t) => t.type === 'page' && t.url.startsWith('mnr://app'),
      child,
    );
    const e = renderer.evaluate;
    await main.evaluate(
      `process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w=>w.webContents.setBackgroundThrottling(false))`,
    );
    const until = async (expr) => {
      for (let n = 0; n < 1000; n++) {
        if (await e(expr)) return;
        await pause(10);
      }
      throw Error('Benchmark Dashboard timeout: ' + expr);
    };
    await renderer.call('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until('!!document.querySelector("[data-dashboard-ready]")');
    await e(
      `(()=>{const fill=(id,v)=>{const x=document.getElementById(id);x.value=v;x.dispatchEvent(new Event(x.tagName==='SELECT'?'change':'input',{bubbles:true}));};fill('dashboard-preset','custom');fill('dashboard-start','2026-10-01');fill('dashboard-end','2026-12-31');document.querySelector('mnr-dashboard form').requestSubmit();})()`,
    );
    await until('!!document.querySelector("[data-dashboard-ready]")');
    const times = [];
    for (let n = 0; n < 6; n++) {
      const start = performance.now();
      await e(
        `Array.from(document.querySelectorAll('mnr-dashboard button')).find(b=>b.textContent.trim()==='Atualizar'&&!b.disabled).click()`,
      );
      await until('!!document.querySelector("[data-dashboard-ready]")');
      await e('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      assert.equal(await e('document.querySelectorAll("[data-metric]").length'), 13);
      if (n) times.push(performance.now() - start);
    }
    const official = await e(
      `window.mnrApi.relatorios.obterResumoGerencial({dataInicio:'2026-10-01',dataFim:'2026-12-31'})`,
    );
    assert.equal(official.ok, true);
    times.sort((a, b) => a - b);
    result.samples.push({
      vendas: volume,
      amostrasMs: times,
      medianaMs: times[2],
      maxMs: times[4],
      mainRss: (await main.evaluate('process.memoryUsage()')).rss,
      rendererJsHeap: await e('performance.memory.usedJSHeapSize'),
      fixture: root,
      official: official.data,
    });
    assert.equal(snapshot(db), before);
    console.log('GERENCIAL_UI_BENCHMARK_VOLUME_OK', volume, times[2]);
  } finally {
    clearTimeout(timer);
    main?.close();
    renderer?.close();
    child.kill();
    if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
    db.close();
  }
}
writeFileSync('.cache/benchmark-gerencial-ui.json', JSON.stringify(result, null, 2));
console.log('GERENCIAL_UI_BENCHMARK_OK');
