const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../../dist/electron/infrastructure/database');
const { createRefundReversalService } = require('../../dist/electron/services/reembolsos-estornos');
(async () => {
  const db = await openDatabase(workerData.directory, 'worker');
  let outcome;
  try {
    const service = createRefundReversalService(db, 'worker');
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    try {
      outcome = { result: service.pagarReembolso(workerData.command) };
    } catch (e) {
      outcome = { code: e.code };
    }
  } finally {
    db.close();
  }
  // A reply must not authorize the parent to terminate an open SQLite connection.
  parentPort.postMessage(outcome);
})();
