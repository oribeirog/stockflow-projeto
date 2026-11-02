const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createFinancialService } = require('../../dist/electron/services/financeiro');
const { createCorrectionService } = require('../../dist/electron/services/correcoes');
(async () => {
  const db = await openDatabase(workerData.directory, 'worker');
  try {
    const service = workerData.correction
      ? createCorrectionService(db, 'worker')
      : createFinancialService(db, 'worker');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      parentPort.postMessage({ result: service[workerData.method](workerData.command) });
    } catch (e) {
      parentPort.postMessage({ code: e.code, message: e.message });
    }
  } finally {
    db.close();
  }
})();
