// Genuine owner-approved schema-5 runtime, built outside the application package.
// The lock coordinates parallel Node test files; an interrupted preparation is preserved.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'),
  cache = path.join(root, '.cache');
function approvedRuntime(cacheName = 'pre52a-approved-v5') {
  if (!/^pre52a-approved-[a-z0-9-]+$/.test(cacheName)) throw Error('Invalid fixture cache name');
  const base = path.join(cache, cacheName),
    entry = path.join(base, 'dist/electron/services/backup/controller.js');
  if (fs.existsSync(entry)) return base;
  fs.mkdirSync(cache, { recursive: true });
  const lock = base + '.lock',
    identity = crypto.randomUUID();
  let handle;
  for (let n = 0; n < 600; n++) {
    try {
      handle = fs.openSync(lock, 'wx');
      fs.writeFileSync(handle, identity);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (fs.existsSync(entry)) return base;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  if (handle === undefined)
    throw Error('Approved fixture preparation interrupted or busy; cache preserved');
  try {
    if (fs.existsSync(entry)) return base;
    if (fs.existsSync(base))
      throw Error('Incomplete approved fixture preserved for inspection: ' + cacheName);
    const staging = fs.mkdtempSync(path.join(cache, cacheName + '-preparing-')),
      archive = staging + '.tar';
    execFileSync('git', ['archive', '--format=tar', '--output=' + archive, '026daa0'], {
      cwd: root,
    });
    execFileSync('tar', ['-xf', archive, '-C', staging], { cwd: root });
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        path.join(staging, 'tsconfig.electron.json'),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        },
      },
    );
    for (const target of [staging, base]) {
      const rel = path.relative(cache, path.resolve(target));
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
        throw Error('Fixture outside exclusive cache');
    }
    fs.renameSync(staging, base);
    return base;
  } finally {
    fs.closeSync(handle);
    if (fs.readFileSync(lock, 'utf8') === identity) fs.unlinkSync(lock);
  }
}
module.exports = { approvedRuntime };
