const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createStockReversalService } = require('../../dist/electron/services/estornos-estoque');
(async () => {
  const db = await openDatabase(workerData.directory, 'test');
  try {
    const service = createStockReversalService(db, 'test');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      parentPort.postMessage({ result: service.estornar(workerData.command) });
    } catch (e) {
      parentPort.postMessage({ code: e.code });
    }
  } finally {
    db.close();
  }
})();
