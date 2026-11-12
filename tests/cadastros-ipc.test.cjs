const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync } = require('node:fs');
const { resolve } = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../dist/electron/infrastructure/database/index.js');
const { criarHandlersCadastros, erroCadastro } = require('../dist/electron/ipc/cadastros.js');
const { CANAIS_CADASTROS, MENSAGENS_CADASTRO } = require('../dist/shared/cadastros-ipc.js');
const { CadastroError } = require('../dist/electron/services/catalog-validation.js');
const { isTrustedSender, isTrustedRequest } = require('../dist/electron/ipc/trust.js');
async function fixture(t) {
  mkdirSync('.local-data/test', { recursive: true });
  const directory = mkdtempSync(resolve('.local-data/test/handlers-'));
  const db = await openDatabase(directory, 'test');
  t.after(() => db.close());
  const handlers = criarHandlersCadastros(db, 'test');
  const invoke = (channel, ...args) => handlers.get(channel)(...args);
  return { db, directory, handlers, invoke };
}
let sequence = 0;
const cmd = (dados, operacaoId = `ipc-${++sequence}`) => ({
  operacaoId,
  motivo: 'Teste IPC',
  dados,
});
function data(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}
function error(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  assert.equal(result.error.message, MENSAGENS_CADASTRO[code]);
}

test('18 explicit handlers preserve full saves, idempotency, audit, history and isolated schema v5', async (t) => {
  const { db, handlers, invoke } = await fixture(t);
  assert.equal(handlers.size, 18);
  assert.equal(handlers.has('cadastros:formas-pagamento:listar'), true);
  const saved = {};
  for (const name of ['marcas', 'categorias', 'clientes', 'fornecedores', 'produtos']) {
    const c = CANAIS_CADASTROS[name];
    const input =
      name === 'produtos'
        ? {
            nome: 'Perfume',
            sku: 'IPC',
            marcaId: saved.marcas.id,
            categoriaId: saved.categorias.id,
            volumeMicrolitros: 1000,
            precoVendaCentavos: 1050,
            estoqueMinimo: 0,
          }
        : { nome: `Água ${name}` };
    const command = cmd(input);
    const original = data(invoke(c.salvar, command));
    saved[name] = original;
    assert.deepEqual(data(invoke(c.salvar, command)), original);
    assert.deepEqual(data(invoke(c.obter, original.id)), original);
    assert.equal(data(invoke(c.listar, {})).length, 1);
    error(invoke(c.salvar, { ...command, motivo: 'Diferente' }), 'IDEMPOTENCY_CONFLICT');
    const inactive = data(invoke(c.salvar, cmd({ ...input, id: original.id, ativo: false })));
    assert.equal(inactive.ativo, false);
    assert.equal(data(invoke(c.listar, { ativo: true })).length, 0);
    assert.equal(data(invoke(c.listar, { ativo: false })).length, 1);
    assert.equal(
      data(invoke(c.salvar, cmd({ ...input, id: original.id, ativo: true }))).ativo,
      true,
    );
    error(invoke(c.obter, 999999), 'NOT_FOUND');
  }
  assert.equal(db.prepare('SELECT count(*) n FROM operacoes').get().n, 15);
  assert.equal(db.prepare('SELECT count(*) n FROM eventos_auditoria').get().n, 15);
  assert.equal(db.prepare('SELECT count(*) n FROM historico_precos').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM movimentacoes_estoque').get().n, 0);
  assert.equal(db.pragma('user_version', { simple: true }), 5);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('every handler rejects bad arity, unknown fields, invalid IDs and inputs without writes', async (t) => {
  const { db, invoke } = await fixture(t);
  for (const channels of Object.values(CANAIS_CADASTROS)) {
    for (const channel of Object.values(channels)) {
      error(invoke(channel), 'VALIDATION');
      error(invoke(channel, {}, {}), 'VALIDATION');
      error(invoke(channel, undefined), 'VALIDATION');
      error(invoke(channel, null), 'VALIDATION');
    }
    for (const id of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', {}, []])
      error(invoke(channels.obter, id), 'VALIDATION');
    for (const query of [
      [],
      'sql',
      { sql: 'SELECT 1' },
      { limite: 201 },
      { limite: 0 },
      { deslocamento: -1 },
      { ativo: 1 },
      { busca: 'x'.repeat(201) },
    ])
      error(invoke(channels.listar, query), 'VALIDATION');
    error(invoke(channels.salvar, cmd({ nome: 'A', inesperado: true })), 'VALIDATION');
    error(invoke(channels.salvar, { ...cmd({ nome: 'A' }), extra: true }), 'VALIDATION');
  }
  assert.equal(db.prepare('SELECT count(*) n FROM operacoes').get().n, 0);
});

test('literal accent-insensitive search, bounded stable pages and business errors survive IPC', async (t) => {
  const { invoke } = await fixture(t);
  const c = CANAIS_CADASTROS.clientes;
  for (let i = 0; i < 205; i++) data(invoke(c.salvar, cmd({ nome: 'Álvaro' })));
  assert.equal(data(invoke(c.listar, {})).length, 50);
  assert.equal(data(invoke(c.listar, { limite: 200 })).length, 200);
  const first = data(invoke(c.listar, { busca: 'alvaro', limite: 1 }))[0];
  const second = data(invoke(c.listar, { busca: 'alvaro', limite: 1, deslocamento: 1 }))[0];
  assert.notEqual(first.id, second.id);
  assert.equal(data(invoke(c.listar, { busca: '%' })).length, 0);
  const b = CANAIS_CADASTROS.marcas;
  data(invoke(b.salvar, cmd({ nome: 'Única' })));
  error(invoke(b.salvar, cmd({ nome: 'unica' })), 'CONFLICT');
  const category = data(
    invoke(CANAIS_CADASTROS.categorias.salvar, cmd({ nome: 'Categoria', ativo: false })),
  );
  const p = {
    nome: 'P',
    sku: 'P',
    marcaId: 1,
    categoriaId: category.id,
    volumeMicrolitros: 1,
    precoVendaCentavos: 0,
    estoqueMinimo: 0,
  };
  error(invoke(CANAIS_CADASTROS.produtos.salvar, cmd(p)), 'INACTIVE_REFERENCE');
  error(
    invoke(c.salvar, cmd({ nome: 'A', tipoPessoa: 'PF', documento: '11111111111' })),
    'VALIDATION',
  );
});

test('real lock maps DATABASE_BUSY, rolls back and allows retry with original command', async (t) => {
  const { db, directory, invoke } = await fixture(t);
  db.pragma('busy_timeout=1');
  const other = new Database(resolve(directory, 'mnr-perfumes.db'));
  t.after(() => other.close());
  const command = cmd({ nome: 'Bloqueado' });
  other.exec('BEGIN IMMEDIATE');
  try {
    error(invoke(CANAIS_CADASTROS.marcas.salvar, command), 'DATABASE_BUSY');
  } finally {
    other.exec('ROLLBACK');
  }
  assert.equal(db.prepare('SELECT count(*) n FROM operacoes').get().n, 0);
  data(invoke(CANAIS_CADASTROS.marcas.salvar, command));
});

test('public errors never include native messages, SQL, paths or stack traces', () => {
  const secret = 'SQL SELECT * C:/Users/private Electron stack';
  for (const code of [
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'INACTIVE_REFERENCE',
    'IDEMPOTENCY_CONFLICT',
  ])
    error(erroCadastro(new CadastroError(code, secret)), code);
  for (const [native, expected] of [
    ['SQLITE_BUSY', 'DATABASE_BUSY'],
    ['SQLITE_LOCKED_SHAREDCACHE', 'DATABASE_BUSY'],
    ['SQLITE_CORRUPT', 'INTEGRITY'],
    ['SQLITE_NOTADB', 'INTEGRITY'],
    ['SQLITE_CONSTRAINT_FOREIGNKEY', 'CONFLICT'],
    ['SQLITE_IOERR', 'INTERNAL_ERROR'],
  ])
    error(erroCadastro(Object.assign(new Error(secret), { code: native })), expected);
  error(erroCadastro(new Error(secret)), 'INTERNAL_ERROR');
});

test('sender validation rejects other contents, child/null frame, URL variants; hash and dev origin work', () => {
  for (const url of ['mnr://app/index.html', 'http://127.0.0.1:4200/']) {
    const frame = { url: url + '#/clientes' };
    const window = { webContents: { mainFrame: frame } };
    const event = { sender: window.webContents, senderFrame: frame };
    assert.equal(isTrustedSender(event, window, url), true);
    assert.equal(isTrustedRequest(event, window, url, [{}], 1), true);
    assert.equal(isTrustedRequest(event, window, url, []), true);
    assert.equal(isTrustedSender({ ...event, sender: {} }, window, url), false);
    assert.equal(isTrustedSender({ ...event, senderFrame: { url } }, window, url), false);
    assert.equal(isTrustedSender({ ...event, senderFrame: null }, window, url), false);
    for (const invalid of [url + '?x=1', url + '/other', 'https://evil.invalid/']) {
      frame.url = invalid;
      assert.equal(isTrustedSender(event, window, url), false);
    }
  }
});

test('registered handlers reject untrusted events before touching SQLite; unknown channels have no handler', async (t) => {
  const { db } = await fixture(t);
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const registered = new Map();
  const sandbox = {
    exports: {},
    require: (name) =>
      name === 'electron'
        ? {
            app: { getVersion: () => 'test' },
            ipcMain: { handle: (channel, handler) => registered.set(channel, handler) },
          }
        : require(resolve('dist/electron/ipc', name)),
    console,
  };
  vm.runInNewContext(readFileSync('dist/electron/ipc/index.js', 'utf8'), sandbox);
  const frame = { url: 'mnr://app/index.html#/clientes' };
  const window = { webContents: { mainFrame: frame } };
  sandbox.exports.registerIpc(window, db, 'mnr://app/index.html');
  assert.equal(registered.size, 77);
  assert.equal(registered.has('financeiro:registrar-recebimento'), true);
  assert.equal(registered.has('correcoes:devolver-venda'), true);
  assert.equal(registered.has('cadastros:sql'), false);
  for (const [channel, handler] of registered) {
    for (const event of [
      { sender: {}, senderFrame: frame },
      { sender: window.webContents, senderFrame: null },
      { sender: window.webContents, senderFrame: { url: frame.url } },
    ]) {
      assert.throws(() => handler(event, cmd({ nome: 'Não autorizado' })), /não autorizada/);
    }
    if (channel.startsWith('exportacoes:')) {
      const response = await handler(
        { sender: window.webContents, senderFrame: frame },
        {},
        'extra',
      );
      assert.equal(response.error.code, 'VALIDATION');
    } else if (channel.startsWith('relatorios:')) {
      const response = handler({ sender: window.webContents, senderFrame: frame }, {}, 'extra');
      assert.equal(response.error.code, 'VALIDATION');
      assert.equal(
        response.error.message,
        'Confira os filtros, o período e a paginação do relatório.',
      );
    } else if (
      channel.startsWith('estoque:') ||
      channel.startsWith('compras:') ||
      channel.startsWith('financeiro:') ||
      channel.startsWith('correcoes:') ||
      channel.startsWith('vendas:')
    )
      assert.equal(
        handler({ sender: window.webContents, senderFrame: frame }, {}, 'extra').error.code,
        'VALIDATION',
      );
    else if (channel !== 'system:get-status')
      error(handler({ sender: window.webContents, senderFrame: frame }, {}, 'extra'), 'VALIDATION');
  }
  assert.equal(db.prepare('SELECT count(*) n FROM operacoes').get().n, 0);
});

test('bundled preload exposes only the approved fixed namespaces and cadastral APIs', async () => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  let exposed;
  const calls = [];
  vm.runInNewContext(readFileSync('dist/electron/preload/index.cjs', 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (key, api) => {
            assert.equal(key, 'mnrApi');
            exposed = api;
          },
        },
        ipcRenderer: {
          invoke: (channel, ...args) => {
            calls.push({ channel, args });
            return Promise.resolve({ ok: true, data: [] });
          },
        },
      };
    },
  });
  assert.deepEqual(Object.keys(exposed).sort(), [
    'cadastros',
    'compras',
    'correcoes',
    'estoque',
    'exportacoes',
    'financeiro',
    'fotos',
    'relatorios',
    'system',
    'vendas',
  ]);
  assert.deepEqual(Object.keys(exposed.cadastros).sort(), Object.keys(CANAIS_CADASTROS).sort());
  for (const [name, channels] of Object.entries(CANAIS_CADASTROS)) {
    assert.deepEqual(Object.keys(exposed.cadastros[name]).sort(), ['listar', 'obter', 'salvar']);
    for (const [operation, channel] of Object.entries(channels)) {
      const input = operation === 'obter' ? 1 : {};
      await exposed.cadastros[name][operation](input);
      assert.deepEqual(calls.at(-1), { channel, args: [input] });
    }
  }
});
