const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createSaleCorrectionService } = require('../../dist/electron/services/correcoes-vendas');
(async () => {
  const db = await openDatabase(workerData.directory, 'worker');
  try {
    const service = createSaleCorrectionService(db, 'worker');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      parentPort.postMessage({ result: service.devolverVenda(workerData.command) });
    } catch (e) {
      parentPort.postMessage({ code: e.code });
    }
  } finally {
    db.close();
  }
})();
