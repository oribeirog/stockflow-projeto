import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import electron from 'electron';
import { environment } from './env.mjs';
const root = resolve('.cache/pre52b-internet');
mkdirSync(root, { recursive: true });
const python =
  process.env.MNR_PYTHON ??
  join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
for (const [exe, args] of [
  [python, ['scripts/generate-fotos-internet.py', root]],
  [electron, ['scripts/fotos-internet-runtime.cjs', root]],
  [python, ['scripts/verify-fotos.py', root, 'internet-cases.json']],
]) {
  const r = spawnSync(exe, args, { env: environment(), stdio: 'inherit', timeout: 120000 });
  assert.ifError(r.error);
  assert.equal(r.status, 0);
}
