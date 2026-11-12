const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const promises = require('node:fs/promises');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { resolve, join } = require('node:path');
const {
  salvarArquivo,
  mensagemExportacao,
} = require('../dist/electron/services/exportacoes/arquivos');
function directory() {
  fs.mkdirSync('.local-data/test', { recursive: true });
  const root = fs.mkdtempSync(resolve('.local-data/test/gerencial-failure-'));
  fs.writeFileSync(join(root, 'desconhecido.tmp'), 'preservar');
  return root;
}
test('4F4 filesystem failures preserve existing data and clean only the owned temporary; retry succeeds', async (t) => {
  const root = directory(),
    target = join(root, 'relatorio.xlsx');
  for (const code of ['ENOTSUP', 'EACCES', 'EPERM', 'ENOSPC']) {
    t.mock.method(promises, 'link', async () => {
      throw Object.assign(Error('private path'), { code });
    });
    await assert.rejects(salvarArquivo(target, 'xlsx', new Uint8Array([1, 2, 3]), []), { code });
    t.mock.restoreAll();
    assert.deepEqual(fs.readdirSync(root), ['desconhecido.tmp']);
    assert.equal(mensagemExportacao({ code }).code, code);
  }
  const open = promises.open;
  t.mock.method(promises, 'open', async (...args) => {
    const file = await open(...args);
    return {
      writeFile: async () => {
        await file.writeFile(new Uint8Array([1]));
        throw Object.assign(Error('disk full'), { code: 'ENOSPC' });
      },
      close: () => file.close(),
    };
  });
  await assert.rejects(salvarArquivo(target, 'xlsx', new Uint8Array([1, 2, 3]), []), {
    code: 'ENOSPC',
  });
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(root), ['desconhecido.tmp']);
  await assert.rejects(
    salvarArquivo(join(root, 'indisponivel', 'x.xlsx'), 'xlsx', new Uint8Array([1]), []),
    { code: 'ENOENT' },
  );
  await salvarArquivo(target, 'xlsx', new Uint8Array([1, 2, 3]), []);
  assert.deepEqual(fs.readFileSync(target), Buffer.from([1, 2, 3]));
  assert.equal(fs.readFileSync(join(root, 'desconhecido.tmp'), 'utf8'), 'preservar');
});
test('4F4 interruption before atomic publication leaves no final file and never removes unknown files', async (t) => {
  const root = directory(),
    target = join(root, 'interrompido.xlsx');
  const child = fork(resolve('tests/helpers/exportacao-interrompida.cjs'), [target], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  const timer = setTimeout(() => child.kill(), 10000);
  t.after(() => clearTimeout(timer));
  const [event] = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw Error('Child exited before the publication barrier');
    }),
  ]);
  assert.equal(event.phase, 'temporary-synced');
  assert.equal(fs.existsSync(target), false);
  const exit = once(child, 'exit');
  child.kill();
  await exit;
  const files = fs.readdirSync(root);
  assert.equal(fs.existsSync(target), false);
  assert.equal(files.filter((x) => /^\.mnr-export-.*\.tmp$/.test(x)).length, 1);
  assert.equal(fs.readFileSync(join(root, 'desconhecido.tmp'), 'utf8'), 'preservar');
  // Preserve the known remnant for diagnosis too; never sweep user directories.
  await salvarArquivo(join(root, 'nova.xlsx'), 'xlsx', new Uint8Array([4, 5]), []);
  assert.equal(fs.readdirSync(root).length, files.length + 1);
});
