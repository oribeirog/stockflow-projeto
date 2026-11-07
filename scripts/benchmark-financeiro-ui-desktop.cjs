const { app } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: pause } = require('node:timers/promises');
const { openDatabase } = require('../dist/electron/infrastructure/database');
const { snapshot } = require('../tests/helpers/financeiro-consulta-fixture.cjs');
app.on('browser-window-created', (_, win) =>
  win.webContents.once('did-finish-load', () =>
    run(win).then(
      () => {
        console.log('FINANCEIRO_UI_BENCHMARK_OK');
        app.quit();
      },
      (e) => {
        console.error(e);
        app.exit(1);
      },
    ),
  ),
);
require('../dist/electron/main/index.js');
async function run(win) {
  const dir = resolve('.local-data/test', process.env.MNR_UI_TEST_RUN);
  const fixture = JSON.parse(readFileSync(resolve(dir, 'fixture.json'), 'utf8'));
  const db = await openDatabase(resolve(dir, 'data'), 'benchmark');
  const before = snapshot(db),
    evaluate = (s) => win.webContents.executeJavaScript(s);
  const until = async (expression) => {
    for (let i = 0; i < 1000; i++) {
      if (await evaluate(expression)) return;
      await pause(10);
    }
    throw Error('Benchmark UI timeout ' + expression);
  };
  const navigate = async (path, ready) => {
    await evaluate(`location.hash=${JSON.stringify('#/' + path)}`);
    await until(ready);
  };
  const listReady = `!!document.getElementById('financeiro-resultados')&&!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Consultar financeiro'&&b.disabled)`;
  const detailReady = `!!document.querySelector('[data-financial="saldoReceberCentavos"]')&&!document.querySelector('main [role="status"]')`;
  const report = {
    createdAt: new Date().toISOString(),
    fixture,
    queries: {},
    notes:
      'Actual mnr://app Angular/Electron, 1366x768 at 100%; five measured calls after one warmup, including IPC, DOM readiness, polling at 10ms and two animation frames. No cold startup measurement.',
  };
  win.setSize(1366, 768);
  win.webContents.setZoomFactor(1);
  const measure = async (name, prepare, action) => {
    const times = [];
    for (let n = 0; n < 6; n++) {
      await prepare();
      const start = performance.now();
      await action();
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      if (n) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    report.queries[name] = { medianaMs: +times[2].toFixed(3), maxMs: +times[4].toFixed(3) };
  };
  const leave = () => navigate('configuracoes', `!!document.querySelector('mnr-settings')`);
  try {
    await until('!!window.mnrApi?.financeiro&&!!document.querySelector("nav")');
    await measure('aberturaListagem', leave, () => navigate('financeiro/parcelas', listReady));
    const prepareList = () => navigate('financeiro/parcelas', listReady);
    await measure(
      'filtroQuitadas',
      async () => {
        await leave();
        await prepareList();
      },
      async () => {
        await evaluate(
          `(()=>{const e=document.getElementById('financeiro-situacao');e.value='QUITADO';e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await until(listReady);
      },
    );
    await measure(
      'proximaPagina',
      async () => {
        await leave();
        await prepareList();
      },
      async () => {
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Próxima'&&!b.disabled).click()`,
        );
        await until(listReady);
      },
    );
    for (const history of fixture.histories)
      await measure('vendaComMovimentos' + history.movimentos, leave, () =>
        navigate(
          'financeiro/vendas/' + history.id,
          detailReady +
            `&&document.querySelectorAll('[aria-label="Histórico de movimentos"] tbody tr').length===${Math.min(history.movimentos, 25)}`,
        ),
      );
    assert.equal(snapshot(db), before);
    writeFileSync('.cache/benchmark-financeiro-ui.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.queries));
  } finally {
    db.close();
  }
}
