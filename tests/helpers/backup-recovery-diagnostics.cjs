// External harness diagnostics only; keep the original exception when recovery
// intentionally catches an error and selects the protected generation.
function recoveryDiagnostics() {
  const restorers = [];
  for (const [path, methods] of [
    ['../../dist/electron/services/backup/format', ['validateSet', 'databaseInfo']],
    ['../../dist/electron/services/backup/io', ['regularFile', 'hashFile', 'durableJson']],
    ['../../dist/electron/infrastructure/database', ['openDatabase']],
  ]) {
    const mod = require(path);
    for (const method of methods) {
      const original = mod[method];
      mod[method] = async (...args) => {
        try {
          return await original(...args);
        } catch (e) {
          console.error('TEST_RECOVERY_EXCEPTION', method, args[0], e.code ?? e.name, e.message);
          throw e;
        }
      };
      restorers.push(() => (mod[method] = original));
    }
  }
  return () => restorers.reverse().forEach((f) => f());
}
module.exports = { recoveryDiagnostics };
