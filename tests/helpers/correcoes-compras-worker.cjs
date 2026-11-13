const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const {
  createPurchaseCorrectionService,
} = require('../../dist/electron/services/correcoes-compras');
(async () => {
  const db = await openDatabase(workerData.directory, 'test');
  try {
    const service = createPurchaseCorrectionService(db, 'test');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      parentPort.postMessage({ result: service.devolver(workerData.command) });
    } catch (e) {
      parentPort.postMessage({ code: e.code });
    }
  } finally {
    db.close();
  }
})();
