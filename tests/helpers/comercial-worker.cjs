const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database/index.js');
const { createCommercialService } = require('../../dist/electron/services/comercial.js');
(async () => {
  const db = await openDatabase(workerData.directory, 'worker');
  try {
    const service = createCommercialService(db, 'worker');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      parentPort.postMessage({ result: service.confirmar(workerData.command) });
    } catch (e) {
      parentPort.postMessage({ code: e.code, message: e.message });
    }
  } finally {
    db.close();
  }
})().catch((e) => {
  throw e;
});
