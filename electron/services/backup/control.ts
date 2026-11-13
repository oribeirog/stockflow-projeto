import { readFile, readdir, lstat, mkdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ownedFiles, isOwnedFile } from './ownership';
import { openDatabase } from '../../infrastructure/database';
import { record as baseRecord } from '../catalog-validation';
import { databaseInfo, mediaFiles, validateSet, readArchive } from './format';
import {
  BackupError,
  checkedId,
  ensureDirectory,
  safeDirectory,
  hashFile,
  durableJson,
  regularFile,
} from './io';

export function recoveryPaths(root: string) {
  const base = join(root, 'recovery');
  return {
    base,
    sets: join(base, 'sets'),
    work: join(base, 'work'),
    plans: join(base, 'plans'),
    protection: join(base, 'protection'),
    active: join(base, 'active.json'),
    pending: join(base, 'pending.json'),
    last: join(base, 'last.json'),
  };
}
function record(value: unknown, keys: string[]) {
  try {
    return baseRecord(value, keys);
  } catch {
    throw new BackupError('RECOVERY_REQUIRED');
  }
}
export async function initializeRecovery(root: string) {
  await safeDirectory(root);
  const p = recoveryPaths(root);
  for (const path of [p.base, p.sets, p.work, p.plans, p.protection]) await ensureDirectory(path);
  return p;
}
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
async function json(path: string) {
  await regularFile(path, 32768);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new BackupError('RECOVERY_REQUIRED');
  }
}
export async function selection(root: string): Promise<string | null> {
  const p = recoveryPaths(root);
  if (!(await exists(p.active))) return null;
  const o = record(await json(p.active), ['format', 'id']);
  if (o['format'] !== 1) throw new BackupError('RECOVERY_REQUIRED');
  return o['id'] === null ? null : checkedId(o['id']);
}
export function selectedPaths(root: string, id: string | null) {
  const base = id ? join(recoveryPaths(root).sets, checkedId(id)) : root;
  return { data: join(base, 'data'), images: join(base, 'images'), base };
}
export async function newOwnedSet(root: string, area: 'sets' | 'work') {
  const p = await initializeRecovery(root),
    id = randomUUID(),
    path = join(p[area], id);
  if ((await readdir(p[area])).length >= 12) throw new BackupError('RETENTION');
  await mkdir(path);
  await durableJson(join(path, 'owner.json'), { format: 1, id, app: 'MNR Perfumes' });
  return { id, path };
}
interface RestorePlan {
  format: 1;
  id: string;
  old: string | null;
  sequence: number;
  createdAt: string;
  payload: string;
  protection: string;
}
async function planFor(root: string, id: string): Promise<RestorePlan> {
  const o = record(await json(join(recoveryPaths(root).plans, checkedId(id) + '.json')), [
    'format',
    'id',
    'old',
    'sequence',
    'createdAt',
    'payload',
    'protection',
  ]);
  if (
    o['format'] !== 1 ||
    o['id'] !== id ||
    !Number.isSafeInteger(o['sequence']) ||
    Number(o['sequence']) < 1 ||
    typeof o['createdAt'] !== 'string' ||
    !Number.isFinite(Date.parse(o['createdAt'])) ||
    !/^[0-9a-f]{64}$/.test(String(o['payload'])) ||
    !/^[0-9a-f]{64}$/.test(String(o['protection']))
  )
    throw new BackupError('RECOVERY_REQUIRED');
  if (o['old'] !== null) checkedId(o['old']);
  return o as unknown as RestorePlan;
}
async function plans(root: string) {
  const p = recoveryPaths(root),
    result: RestorePlan[] = [];
  for (const name of await readdir(p.plans))
    if (/^[0-9a-f-]{36}\.json$/.test(name)) result.push(await planFor(root, name.slice(0, -5)));
  if (new Set(result.map((r) => r.sequence)).size !== result.length)
    throw new BackupError('RECOVERY_REQUIRED');
  return result.sort((a, b) => b.sequence - a.sequence);
}
async function activate(root: string, id: string | null) {
  await durableJson(recoveryPaths(root).active, { format: 1, id }, true);
}
export async function verifyLive(root: string, id: string | null) {
  const paths = selectedPaths(root, id);
  await safeDirectory(paths.base);
  await safeDirectory(paths.data);
  await safeDirectory(paths.images);
  await safeDirectory(join(paths.images, 'objects'));
  const info = await databaseInfo(join(paths.data, 'mnr-perfumes.db'));
  for (const file of mediaFiles(info.rows)) {
    const actual = await hashFile(join(paths.base, file.path));
    if (actual.size !== file.size || actual.sha256 !== file.sha256)
      throw new BackupError('MISSING_PHOTO');
  }
  return paths;
}
export async function armRestore(
  root: string,
  id: string,
  protectionHash: string,
  payloadHash: string,
) {
  const p = await initializeRecovery(root);
  checkedId(id);
  if (await exists(p.pending)) throw new BackupError('BUSY');
  if ((await hashFile(join(p.protection, id + '.mnrbackup'))).sha256 !== protectionHash)
    throw new BackupError('INVALID_BACKUP');
  await readArchive(join(p.protection, id + '.mnrbackup'));
  if ((await hashFile(join(p.sets, id, 'manifest.json'))).sha256 !== payloadHash)
    throw new BackupError('STALE_REVIEW');
  await validateSet(join(p.sets, id));
  const old = await selection(root);
  await verifyLive(root, old);
  const prior = await plans(root);
  if (prior.length >= 8) throw new BackupError('RETENTION');
  const plan: RestorePlan = {
    format: 1,
    id,
    old,
    sequence: (prior[0]?.sequence ?? 0) + 1,
    createdAt: new Date().toISOString(),
    payload: payloadHash,
    protection: protectionHash,
  };
  await durableJson(join(p.plans, id + '.json'), plan);
  // This durable intent is the only permission to activate on the next cold start.
  await durableJson(p.pending, { format: 1, id });
  return plan;
}
interface Done {
  status: 'restaurado' | 'recuperado';
  criadoEm: string;
  protecao: string;
}
async function readDone(path: string): Promise<Done> {
  const o = record(await json(path), ['status', 'criadoEm', 'protecao']);
  if (
    !['restaurado', 'recuperado'].includes(String(o['status'])) ||
    typeof o['criadoEm'] !== 'string' ||
    !Number.isFinite(Date.parse(o['criadoEm'])) ||
    typeof o['protecao'] !== 'string' ||
    !/^[0-9a-f-]{36}\.mnrbackup$/.test(o['protecao'])
  )
    throw new BackupError('RECOVERY_REQUIRED');
  return o as unknown as Done;
}
export async function lastRecovery(root: string) {
  const p = recoveryPaths(root);
  if (!(await exists(p.last))) return undefined;
  const r = await readDone(p.last);
  return { situacao: r.status, criadoEm: r.criadoEm, protecao: r.protecao };
}
// No recursive removal. Only an exclusively allocated, marked set in our layout
// is eligible. A single unknown entry causes preservation of the entire set.
export async function removeOwnedSet(root: string, area: 'sets' | 'work', id: string) {
  const p = recoveryPaths(root),
    dir = join(p[area], checkedId(id));
  if (!(await exists(dir))) return;
  if (area === 'sets' && (await selection(root)) === id) throw new BackupError('RECOVERY_REQUIRED');
  if (await exists(p.pending)) {
    const pending = record(await json(p.pending), ['format', 'id']);
    const plan = await planFor(root, String(pending['id']));
    if (plan.id === id || plan.old === id) throw new BackupError('RECOVERY_REQUIRED');
  }
  await safeDirectory(dir);
  const owner = record(await json(join(dir, 'owner.json')), ['format', 'id', 'app']);
  if (owner['format'] !== 1 || owner['id'] !== id || owner['app'] !== 'MNR Perfumes')
    throw new BackupError('UNSAFE_STORAGE');
  const allowed =
    /^(owner\.json|ownership\.jsonl|manifest\.json|archive\.partial|data\/mnr-perfumes\.db(?:-wal|-shm)?|images\/(?:objects|staging)\/[0-9a-f-]{36}\.(?:image|thumb))$/;
  const registered = await ownedFiles(dir);
  let ledger: Database.Database | undefined;
  async function recognized(key: string) {
    if (key === 'owner.json' || key === 'ownership.jsonl') return true;
    if (await isOwnedFile(dir, key, registered)) return true;
    if (key === 'data/mnr-perfumes.db-wal' || key === 'data/mnr-perfumes.db-shm')
      return isOwnedFile(dir, 'data/mnr-perfumes.db', registered);
    if (!key.startsWith('images/')) return false;
    // Photos created after activation belong to the photo ledger, not to the
    // original extraction. Verify their persisted hash before considering removal.
    if (!ledger) {
      await databaseInfo(join(dir, 'data/mnr-perfumes.db'));
      ledger = new Database(join(dir, 'data/mnr-perfumes.db'), {
        readonly: true,
        fileMustExist: true,
      });
      ledger.pragma('trusted_schema=OFF');
    }
    const name = key.split('/').at(-1)!,
      id = checkedId(name.split('.')[0]),
      thumb = name.endsWith('.thumb');
    const row = ledger
      .prepare('SELECT hash,tamanho,miniatura_hash,miniatura_tamanho FROM foto_arquivos WHERE id=?')
      .get(id) as
      | { hash: string; tamanho: number; miniatura_hash: string; miniatura_tamanho: number }
      | undefined;
    if (!row) return false;
    const actual = await hashFile(join(dir, key));
    return (
      actual.sha256 === (thumb ? row.miniatura_hash : row.hash) &&
      actual.size === (thumb ? row.miniatura_tamanho : row.tamanho)
    );
  }
  const folders = new Set(['data', 'images', 'images/objects', 'images/staging']);
  const files: string[] = [],
    dirs: string[] = [];
  async function scan(base: string, relative = '') {
    await safeDirectory(base);
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const key = relative ? relative + '/' + entry.name : entry.name,
        target = join(base, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && folders.has(key)) {
        await scan(target, key);
        dirs.push(target);
      } else if (
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        allowed.test(key) &&
        (await recognized(key))
      )
        files.push(target);
      else throw new BackupError('UNSAFE_STORAGE');
    }
  }
  try {
    await scan(dir);
  } finally {
    ledger?.close();
  }
  // Ownership is established by allocation + journal/marker, not filename alone.
  for (const file of files.filter((f) => f !== join(dir, 'owner.json'))) await unlink(file);
  for (const folder of dirs) await rmdir(folder);
  await unlink(join(dir, 'owner.json'));
  await rmdir(dir);
}
export async function pruneProtections(root: string) {
  const p = recoveryPaths(root),
    all = await plans(root),
    completed = [];
  if (await exists(p.pending)) return;
  for (const plan of all)
    if (await exists(join(p.plans, plan.id + '.done.json'))) completed.push(plan);
  const keep = new Set(completed.slice(0, 3).map((p) => p.id));
  const protectedSets = new Set<string>();
  const active = await selection(root);
  if (active) protectedSets.add(active);
  for (const plan of completed.slice(0, 3)) {
    protectedSets.add(plan.id);
    if (plan.old) protectedSets.add(plan.old);
  }
  for (const plan of completed.slice(3)) {
    if (!protectedSets.has(plan.id)) await removeOwnedSet(root, 'sets', plan.id);
    if (plan.old && !protectedSets.has(plan.old)) await removeOwnedSet(root, 'sets', plan.old);
    const archive = join(p.protection, plan.id + '.mnrbackup');
    if (await exists(archive)) {
      if ((await hashFile(archive)).sha256 !== plan.protection) throw new BackupError('RETENTION');
      await unlink(archive);
    }
    // Retain any plan still needed to prove ownership of a preserved generation.
    if (!keep.has(plan.id) && !protectedSets.has(plan.id)) {
      await unlink(join(p.plans, plan.id + '.done.json'));
      await unlink(join(p.plans, plan.id + '.json'));
    }
  }
}
// Called only at cold start, before public IPC and before any worker exists.
export async function cleanupRecoveryStaging(root: string) {
  const p = await initializeRecovery(root);
  if (await exists(p.pending)) return 'Há recuperação pendente; staging preservado.';
  const referenced = new Set<string>();
  const current = await selection(root);
  if (current) referenced.add(current);
  for (const plan of await plans(root)) {
    referenced.add(plan.id);
    if (plan.old) referenced.add(plan.old);
  }
  let preserved = false;
  for (const area of ['work', 'sets'] as const)
    for (const name of await readdir(p[area])) {
      if (area === 'sets' && referenced.has(name)) continue;
      try {
        checkedId(name);
        await removeOwnedSet(root, area, name);
      } catch {
        preserved = true;
      }
    }
  return preserved
    ? 'Temporários não reconhecidos foram preservados. Consulte a pasta de proteção antes de novas restaurações.'
    : undefined;
}
export async function recoverAndOpen(root: string, appVersion: string) {
  const p = await initializeRecovery(root);
  let result: Done | undefined;
  if (await exists(p.pending)) {
    const pending = record(await json(p.pending), ['format', 'id']);
    if (pending['format'] !== 1) throw new BackupError('RECOVERY_REQUIRED');
    const plan = await planFor(root, checkedId(pending['id'])),
      donePath = join(p.plans, plan.id + '.done.json');
    let selected: string | null, db: Awaited<ReturnType<typeof openDatabase>> | undefined;
    if (await exists(donePath)) {
      result = await readDone(donePath);
      selected = result.status === 'restaurado' ? plan.id : plan.old;
      await verifyLive(root, selected);
      await activate(root, selected);
    } else {
      try {
        if ((await hashFile(join(p.protection, plan.id + '.mnrbackup'))).sha256 !== plan.protection)
          throw new BackupError('RECOVERY_REQUIRED');
        if ((await hashFile(join(p.sets, plan.id, 'manifest.json'))).sha256 !== plan.payload)
          throw new BackupError('INVALID_BACKUP');
        await validateSet(join(p.sets, plan.id));
        await activate(root, plan.id);
        const paths = await verifyLive(root, plan.id);
        db = await openDatabase(paths.data, appVersion, undefined, paths.images);
        await verifyLive(root, plan.id);
        selected = plan.id;
        result = {
          status: 'restaurado',
          criadoEm: new Date().toISOString(),
          protecao: plan.id + '.mnrbackup',
        };
      } catch {
        if (db?.open) db.close();
        db = undefined;
        await verifyLive(root, plan.old);
        await activate(root, plan.old);
        selected = plan.old;
        result = {
          status: 'recuperado',
          criadoEm: new Date().toISOString(),
          protecao: plan.id + '.mnrbackup',
        };
      }
      try {
        await durableJson(donePath, result);
      } catch (error) {
        if (db?.open) db.close();
        throw error;
      }
    }
    try {
      await durableJson(p.last, result, true);
      await unlink(p.pending);
    } catch (error) {
      if (db?.open) db.close();
      throw error;
    }
    const paths = selectedPaths(root, selected);
    if (!db) db = await openDatabase(paths.data, appVersion, undefined, paths.images);
    // Retention failure is non-destructive and never invalidates the active set.
    let warning: string | undefined;
    try {
      await pruneProtections(root);
    } catch {
      warning =
        'Proteções antigas foram preservadas para verificação. Consulte a pasta de proteção.';
    }
    return { ...paths, db, warning, recovery: true };
  }
  const current = await selection(root),
    prior = await plans(root);
  let unfinished = false;
  for (const plan of prior)
    if (!(await exists(join(p.plans, plan.id + '.done.json')))) {
      // A failed pending-journal publication can leave a durable plan only.
      // Preserve it and report the incomplete attempt; never silently use an
      // uncommitted generation if its pointer survived an interrupted write.
      if (current === plan.id) throw new BackupError('RECOVERY_REQUIRED');
      unfinished = true;
    }
  for (const plan of prior)
    if (await exists(join(p.plans, plan.id + '.done.json'))) {
      const done = await readDone(join(p.plans, plan.id + '.done.json'));
      if (current !== (done.status === 'restaurado' ? plan.id : plan.old))
        throw new BackupError('RECOVERY_REQUIRED');
      break;
    }
  const paths = selectedPaths(root, current);
  if (current && !(await exists(join(paths.data, 'mnr-perfumes.db'))))
    throw new BackupError('RECOVERY_REQUIRED');
  return {
    ...paths,
    db: await openDatabase(paths.data, appVersion, undefined, paths.images),
    warning: unfinished
      ? 'Uma tentativa de restauração não foi ativada. O conjunto atual foi preservado e validado; consulte as proteções antes de tentar novamente.'
      : undefined,
    recovery: unfinished,
  };
}
