// Child owned by the interruption test; only a fresh, isolated output directory is passed.
const fs = require('node:fs/promises');
fs.link = async () => {
  process.send({ phase: 'temporary-synced' });
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
};
require('../../dist/electron/services/exportacoes/arquivos')
  .salvarArquivo(process.argv[2], 'xlsx', new Uint8Array([1, 2, 3]), [])
  .catch(() => process.exit(1));
