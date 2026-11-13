import { open, lstat, readdir, unlink, rmdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { BackupError, safeDirectory, hashFile } from './io';
const registryName = 'ownership.jsonl';
interface OwnedFile {
  path: string;
  dev: string;
  ino: string;
  birth: string;
  sha256?: string;
  size?: number;
}
const allowed =
  /^(manifest\.json|archive\.partial|[^<>:"/\\|?*\x00-\x1f]+\.mnrbackup|data\/mnr-perfumes\.db|images\/objects\/[0-9a-f-]{36}\.(?:image|thumb))$/;
async function append(root: string, record: OwnedFile) {
  try {
    const s = await lstat(join(root, registryName));
    if (!s.isFile() || s.isSymbolicLink() || s.size > 256 * 1024 ** 2)
      throw new BackupError('UNSAFE_STORAGE');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const log = await open(join(root, registryName), 'a', 0o600);
  try {
    await log.writeFile(JSON.stringify(record) + '\n');
    await log.sync();
  } finally {
    await log.close();
  }
}
export async function ownedOutput(root: string, path: string) {
  if (!allowed.test(path)) throw new BackupError('UNSAFE_STORAGE');
  await safeDirectory(root);
  const file = await open(join(root, path), 'wx', 0o600);
  try {
    const info = await file.stat({ bigint: true }),
      record: OwnedFile = {
        path,
        dev: String(info.dev),
        ino: String(info.ino),
        birth: String(info.birthtimeNs),
      };
    await append(root, record);
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
export async function ownedFiles(root: string) {
  const result = new Map<string, OwnedFile>();
  try {
    const s = await lstat(join(root, registryName));
    if (!s.isFile() || s.isSymbolicLink() || s.size > 256 * 1024 ** 2)
      throw new BackupError('UNSAFE_STORAGE');
    if (s.size) {
      const f = await open(join(root, registryName), 'r');
      try {
        const b = Buffer.alloc(1);
        await f.read(b, 0, 1, s.size - 1);
        if (b[0] !== 10) throw new BackupError('UNSAFE_STORAGE');
      } finally {
        await f.close();
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map<string, OwnedFile>();
    throw e;
  }
  const lines = createInterface({
    input: createReadStream(join(root, registryName)),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.length > 2048) throw new BackupError('UNSAFE_STORAGE');
    const r = JSON.parse(line) as OwnedFile;
    const keys = Object.keys(r ?? {})
        .sort()
        .join(','),
      old = result.get(r?.path);
    if (
      !r ||
      !['birth,dev,ino,path', 'birth,dev,ino,path,sha256,size'].includes(keys) ||
      !allowed.test(r.path) ||
      ![r.birth, r.dev, r.ino].every((s) => typeof s === 'string' && /^\d+$/.test(s))
    )
      throw new BackupError('UNSAFE_STORAGE');
    if (
      old &&
      (old.sha256 || !r.sha256 || old.dev !== r.dev || old.ino !== r.ino || old.birth !== r.birth)
    )
      throw new BackupError('UNSAFE_STORAGE');
    if (
      r.sha256 &&
      (!/^[0-9a-f]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.size) || Number(r.size) < 0)
    )
      throw new BackupError('UNSAFE_STORAGE');
    result.set(r.path, r);
  }
  return result;
}
export async function completeOwned(
  root: string,
  path: string,
  value: { size: number; sha256: string },
) {
  const s = await lstat(join(root, path), { bigint: true });
  await append(root, {
    path,
    dev: String(s.dev),
    ino: String(s.ino),
    birth: String(s.birthtimeNs),
    ...value,
  });
}
export async function isOwnedFile(root: string, path: string, records: Map<string, OwnedFile>) {
  const r = records.get(path);
  if (!r) return false;
  const s = await lstat(join(root, path), { bigint: true });
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    String(s.dev) !== r.dev ||
    String(s.ino) !== r.ino ||
    String(s.birthtimeNs) !== r.birth
  )
    return false;
  if (r.sha256 && !path.startsWith('data/')) {
    const value = await hashFile(join(root, path));
    return value.size === r.size && value.sha256 === r.sha256;
  }
  return true;
}
export async function removeExternalStaging(root: string) {
  await safeDirectory(root);
  const names = await readdir(root);
  if (names.some((n) => n !== 'archive.partial' && n !== registryName))
    throw new BackupError('UNSAFE_STORAGE');
  const records = await ownedFiles(root);
  if (names.includes('archive.partial')) {
    if (!(await isOwnedFile(root, 'archive.partial', records)))
      throw new BackupError('UNSAFE_STORAGE');
    await unlink(join(root, 'archive.partial'));
  }
  if (names.includes(registryName)) await unlink(join(root, registryName));
  await rmdir(root);
}
