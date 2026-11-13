import { parentPort, workerData } from 'node:worker_threads';
import { captureSet, packageSet, inspectArchive, validateSet } from './format';
import { backupMessage } from './io';
async function run() {
  switch (workerData.task) {
    case 'capture':
      return captureSet(
        workerData.database,
        workerData.images,
        workerData.target,
        workerData.version,
      );
    case 'package':
      return packageSet(workerData.source, workerData.target);
    case 'inspect':
      return inspectArchive(workerData.source, workerData.target);
    case 'validate':
      return (await validateSet(workerData.source)).summary;
    default:
      throw Error('Unknown internal task');
  }
}
void run().then(
  (data) => parentPort!.postMessage({ ok: true, data }),
  (e) => parentPort!.postMessage({ ok: false, error: backupMessage(e) }),
);
