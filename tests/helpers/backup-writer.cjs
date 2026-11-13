const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createCatalogService } = require('../../dist/electron/services/catalogos');
const { randomUUID } = require('node:crypto');
(async () => {
  const db = await openDatabase(workerData.directory, 'test'),
    cat = createCatalogService(db, 'test');
  let n = 0;
  try {
    do {
      cat.savePerson('CLIENTE', {
        operacaoId: randomUUID(),
        motivo: 'Concorrência de snapshot SQLite',
        dados: { nome: `BK-CONCURRENT-${String(n).padStart(5, '0')}` },
      });
      n++;
      if (n === 1) parentPort.postMessage({ ready: true });
      await new Promise((r) => setTimeout(r, 2));
    } while (Atomics.load(new Int32Array(workerData.stop), 0) === 0 && n < 10000);
    parentPort.postMessage({ count: n });
  } finally {
    db.close();
  }
})().catch((e) => {
  throw e;
});
