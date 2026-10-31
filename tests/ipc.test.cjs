const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedRequest } = require('../dist/electron/ipc/trust.js');
const frame = { url: 'mnr://app/index.html' };
const window = { webContents: { mainFrame: frame } };
const event = { sender: window.webContents, senderFrame: frame };
test('IPC accepts only the authorized main frame without arguments', () => {
  assert.equal(isTrustedRequest(event, window, frame.url, []), true);
  assert.equal(isTrustedRequest(event, window, frame.url, ['unexpected']), false);
  assert.equal(isTrustedRequest({ ...event, sender: {} }, window, frame.url, []), false);
  assert.equal(
    isTrustedRequest({ ...event, senderFrame: { url: frame.url } }, window, frame.url, []),
    false,
  );
  assert.equal(isTrustedRequest(event, window, 'https://untrusted.invalid/', []), false);
  assert.equal(isTrustedRequest({ ...event, senderFrame: null }, window, frame.url, []), false);
});
