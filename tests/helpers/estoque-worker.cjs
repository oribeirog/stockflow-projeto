const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database/index.js');
const { createStockService } = require('../../dist/electron/services/estoque.js');
(async () => {
  const db = await openDatabase(workerData.directory, 'worker');
  try {
    const gate = new Int32Array(workerData.gate);
    parentPort.postMessage({ ready: true });
    Atomics.wait(gate, 0, 0);
    try {
      const result = createStockService(db, 'worker').registrarSaida(workerData.command);
      parentPort.postMessage({ result });
    } catch (error) {
      parentPort.postMessage({ code: error.code, message: error.message });
    }
  } finally {
    db.close();
  }
})().catch((error) => {
  throw error;
});
