const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { relaunchApplication, recordStartupError } = require('../dist/electron/main/lifecycle');

test('5.1 relaunch remains official for packaged and unsupervised apps', () => {
  for (const isPackaged of [false, true]) {
    const calls = [];
    relaunchApplication(
      { isPackaged, relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') },
      { env: { MNR_DEV: '1', MNR_DEV_SUPERVISED: '1' }, connected: false },
    );
    assert.deepEqual(calls, ['relaunch', 'quit']);
  }
  const calls = [];
  relaunchApplication(
    { isPackaged: true, relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') },
    {
      env: { MNR_DEV: '1', MNR_DEV_SUPERVISED: '1' },
      connected: true,
      send: () => assert.fail('Packaged app cannot use development supervisor'),
    },
  );
  assert.deepEqual(calls, ['relaunch', 'quit']);
});

test('5.1 supervised relaunch sends one fixed intent, flushes it and quits before replacement', () => {
  const calls = [];
  let acknowledge;
  const app = {
    isPackaged: false,
    relaunch: () => calls.push('relaunch'),
    quit: () => calls.push('quit'),
  };
  const host = Object.assign(new (require('node:events').EventEmitter)(), {
    env: { MNR_DEV: '1', MNR_DEV_SUPERVISED: '1' },
    connected: true,
    send: (message, handle, options, callback) => {
      assert.deepEqual(message, { type: 'mnr:relaunch' });
      assert.equal(handle, undefined);
      assert.equal(options, undefined);
      acknowledge = callback;
      calls.push('intent');
      return true;
    },
  });
  relaunchApplication(app, host);
  assert.deepEqual(calls, ['intent']);
  acknowledge(null);
  assert.deepEqual(calls, ['intent']);
  host.emit('message', { type: 'mnr:relaunch-ready', extra: true });
  assert.deepEqual(calls, ['intent']);
  host.emit('message', { type: 'mnr:relaunch-ready' });
  assert.deepEqual(calls, ['intent', 'quit']);
  calls.length = 0;
  relaunchApplication(app, host);
  acknowledge(Error('Disconnected parent'));
  assert.deepEqual(calls, ['intent', 'quit']);
});

test('5.1 startup logs retain original exception and phase, redact paths and never overwrite a record', async (t) => {
  fs.mkdirSync('.local-data/test', { recursive: true });
  const root = fs.mkdtempSync(resolve('.local-data/test/startup-diagnostics-')),
    logs = join(root, 'logs');
  fs.mkdirSync(logs);
  t.mock.method(console, 'error', () => {});
  const error = Object.assign(
    Error('ERR_CONNECTION_REFUSED (-102) loading http://127.0.0.1:4200/'),
    { code: 'ERR_CONNECTION_REFUSED' },
  );
  error.stack +=
    '\n at ' +
    root +
    '\\data\\bank.db\n at C:\\Sensitive\\bank.db\n at ' +
    process.cwd() +
    '\\dist\\electron\\main\\index.js:144';
  await recordStartupError(error, 'interface', root, logs);
  await recordStartupError(error, 'recovery', root, logs);
  const names = fs.readdirSync(logs);
  assert.equal(names.length, 2);
  const entries = names.map((n) => JSON.parse(fs.readFileSync(join(logs, n))));
  assert.deepEqual(entries.map((e) => e.phase).sort(), ['interface', 'recovery']);
  for (const e of entries) {
    assert.equal(e.code, 'ERR_CONNECTION_REFUSED');
    assert.match(e.message, /-102/);
    assert.match(e.stack, /<dados>/);
    assert.match(e.stack, /<app>/);
    assert(!JSON.stringify(e).includes('Sensitive'));
    assert(!e.stack.includes(root));
  }
});
