import Database from 'better-sqlite3';
import {
  mkdirSync,
  existsSync,
  lstatSync,
  readFileSync,
  openSync,
  readSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  realpathSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { inspectDatabase } from '../infrastructure/database/migrate';
import { fotoId, type FotoArquivo, type FotoService } from './fotos';

interface SnapshotFile {
  path: string;
  size: number;
  sha256: string;
}
interface Manifest {
  format: 1;
  databaseId: string;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  files: SnapshotFile[];
}
function hashFile(path: string): SnapshotFile {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Arquivo de backup inválido');
  const hash = createHash('sha256'),
    fd = openSync(path, 'r'),
    chunk = Buffer.alloc(65536);
  let size = 0;
  try {
    let count;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, count));
      size += count;
    }
  } finally {
    closeSync(fd);
  }
  if (size !== stat.size) throw new Error('Arquivo mudou durante a cópia');
  return { path: '', size, sha256: hash.digest('hex') };
}
function writeFile(path: string, bytes: Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'wx');
  try {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function safeDirectory(path: string) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    resolve(realpathSync(path)).toLowerCase() !== resolve(path).toLowerCase()
  )
    throw new Error('Diretório de backup inválido');
}
function referenceRows(db: Database.Database): FotoArquivo[] {
  return db
    .prepare('SELECT a.* FROM foto_arquivos a JOIN produto_fotos p ON p.foto_id=a.id ORDER BY a.id')
    .all() as FotoArquivo[];
}
function expectedMedia(rows: FotoArquivo[]): SnapshotFile[] {
  return rows.flatMap((row) => {
    fotoId(row.id);
    return [
      { path: `images/objects/${row.id}.image`, size: row.tamanho, sha256: row.hash },
      {
        path: `images/objects/${row.id}.thumb`,
        size: row.miniatura_tamanho,
        sha256: row.miniatura_hash,
      },
    ];
  });
}
function validateBundle(directory: string): Manifest {
  safeDirectory(directory);
  safeDirectory(join(directory, 'data'));
  const manifestPath = join(directory, 'manifest.json'),
    stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error('Manifesto inválido');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (
    manifest.format !== 1 ||
    typeof manifest.databaseId !== 'string' ||
    !Number.isSafeInteger(manifest.schemaVersion) ||
    typeof manifest.appVersion !== 'string' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100001
  )
    throw new Error('Manifesto inválido');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (
      typeof file?.path !== 'string' ||
      !/^(data\/mnr-perfumes\.db|images\/objects\/[0-9a-f-]{36}\.(image|thumb))$/.test(file.path) ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    )
      throw new Error('Entrada de backup inválida');
    if (file.path.startsWith('images/')) {
      safeDirectory(join(directory, 'images'));
      safeDirectory(join(directory, 'images/objects'));
    }
    seen.add(file.path);
    const actual = hashFile(join(directory, file.path));
    if (actual.size !== file.size || actual.sha256 !== file.sha256)
      throw new Error('Hash de backup inválido');
  }
  if (!seen.has('data/mnr-perfumes.db')) throw new Error('Snapshot ausente');
  const db = new Database(join(directory, 'data/mnr-perfumes.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma('trusted_schema=OFF');
    db.pragma('foreign_keys=ON');
    const identity = inspectDatabase(db);
    if (
      identity.identity?.identificador !== manifest.databaseId ||
      identity.version !== manifest.schemaVersion
    )
      throw new Error('Identidade do snapshot inválida');
    const expected = expectedMedia(referenceRows(db));
    if (
      expected.length + 1 !== manifest.files.length ||
      expected.some(
        (file) =>
          !manifest.files.some(
            (item) =>
              item.path === file.path && item.size === file.size && item.sha256 === file.sha256,
          ),
      )
    )
      throw new Error('Imagens não correspondem ao snapshot');
  } finally {
    db.close();
  }
  return manifest;
}
export function createMediaSnapshot(
  db: Database.Database,
  photos: FotoService,
  destination: string,
  appVersion: string,
  afterDatabase?: () => Promise<void>,
): Promise<string> {
  return photos.withLock(async () => {
    const target = resolve(destination);
    if (existsSync(target)) throw new Error('Destino já existe');
    mkdirSync(dirname(target), { recursive: true });
    safeDirectory(dirname(target));
    const pending = target + '.partial-' + randomUUID();
    mkdirSync(join(pending, 'data'), { recursive: true });
    const databasePath = join(pending, 'data/mnr-perfumes.db');
    await db.backup(databasePath);
    await afterDatabase?.();
    const copy = new Database(databasePath, { readonly: true });
    let rows: FotoArquivo[], identity: ReturnType<typeof inspectDatabase>;
    try {
      copy.pragma('trusted_schema=OFF');
      copy.pragma('foreign_keys=ON');
      identity = inspectDatabase(copy);
      rows = referenceRows(copy);
    } finally {
      copy.close();
    }
    const files: SnapshotFile[] = [{ ...hashFile(databasePath), path: 'data/mnr-perfumes.db' }];
    for (const row of rows)
      for (const variant of ['image', 'thumb'] as const) {
        const path = `images/objects/${row.id}.${variant}`;
        writeFile(join(pending, path), photos.verified(row, variant));
        files.push({ ...hashFile(join(pending, path)), path });
      }
    const manifest: Manifest = {
      format: 1,
      databaseId: identity.identity!.identificador,
      schemaVersion: identity.version,
      appVersion,
      createdAt: new Date().toISOString(),
      files,
    };
    writeFile(join(pending, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2)));
    validateBundle(pending);
    renameSync(pending, target);
    return target;
  });
}
// Internal building block. No restore IPC/UI is exposed in 4B.
export function restoreMediaSnapshot(source: string, destination: string): string {
  const sourceRoot = resolve(source),
    target = resolve(destination);
  if (existsSync(target)) throw new Error('Restauração exige diretório novo');
  const manifest = validateBundle(sourceRoot);
  mkdirSync(dirname(target), { recursive: true });
  safeDirectory(dirname(target));
  const pending = target + '.partial-' + randomUUID();
  mkdirSync(pending);
  for (const file of manifest.files)
    writeFile(join(pending, file.path), readFileSync(join(sourceRoot, file.path)));
  writeFile(join(pending, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2)));
  validateBundle(pending);
  renameSync(pending, target);
  return target;
}
