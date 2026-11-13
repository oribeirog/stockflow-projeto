import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { Transform, Writable, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yazl from 'yazl';
import * as yauzl from 'yauzl';
import { canonical, record } from '../catalog-validation';
import {
  inspectDatabase,
  migrateDatabase,
  migrations,
} from '../../infrastructure/database/migrate';
import { reconciliarEstoque } from '../estoque-reconciliation';
import { reconciliarComercial } from '../comercial-reconciliation';
import { reconciliarFinanceiro } from '../financeiro-reconciliation';
import { fotoId, type FotoArquivo } from '../fotos';
import { imageHeader } from '../foto-validation';
import { ownedOutput, completeOwned } from './ownership';
import type { BackupSummary } from '../../../shared/backup';
import {
  BackupError,
  checkedId,
  ensureDirectory,
  regularFile,
  hashFile,
  syncFile,
  safeDirectory,
  spaceFor,
} from './io';

export const BACKUP_APP = 'br.com.mnrsoftware.mnrperfumes';
export const BACKUP_LIMITS = {
  entries: 200001,
  manifestBytes: 32 * 1024 ** 2,
  databaseBytes: 128 * 1024 ** 3,
  totalBytes: 512 * 1024 ** 3,
};
export interface BackupFile {
  path: string;
  size: number;
  sha256: string;
}
export interface Manifest {
  app: string;
  format: 1;
  schema: number;
  databaseId: string;
  appVersion: string;
  createdAt: string;
  files: BackupFile[];
}
const filePattern = /^(data\/mnr-perfumes\.db|images\/objects\/[0-9a-f-]{36}\.(image|thumb))$/;
const schemaSql = (db: Database.Database) =>
  canonical(
    db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all(),
  );
let schemaPromise: Promise<string> | undefined;
function trustedSchema() {
  return (schemaPromise ??= (async () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys=ON');
      db.pragma('trusted_schema=OFF');
      await migrateDatabase(db, {
        directory: '.',
        existed: false,
        appVersion: 'schema-validation',
      });
      return schemaSql(db);
    } finally {
      db.close();
    }
  })());
}
export function mediaRows(db: Database.Database) {
  return db
    .prepare('SELECT a.* FROM foto_arquivos a JOIN produto_fotos p ON p.foto_id=a.id ORDER BY a.id')
    .all() as FotoArquivo[];
}
export function mediaFiles(rows: FotoArquivo[]): BackupFile[] {
  return rows.flatMap((r) => {
    fotoId(r.id);
    return [
      { path: `images/objects/${r.id}.image`, size: r.tamanho, sha256: r.hash },
      { path: `images/objects/${r.id}.thumb`, size: r.miniatura_tamanho, sha256: r.miniatura_hash },
    ];
  });
}
export async function databaseInfo(path: string) {
  await regularFile(path, BACKUP_LIMITS.databaseBytes);
  const expected = await trustedSchema(),
    db = new Database(path, { readonly: true, fileMustExist: true, timeout: 1500 });
  try {
    db.pragma('trusted_schema=OFF');
    db.pragma('foreign_keys=ON');
    db.pragma('query_only=ON');
    db.pragma('cache_size=-8192');
    db.pragma('mmap_size=0');
    if (db.pragma('user_version', { simple: true }) !== migrations.length)
      throw new BackupError('INCOMPATIBLE');
    // Check stored SQL before invoking constraints, domain queries or any write.
    if (schemaSql(db) !== expected) throw new BackupError('INVALID_BACKUP');
    const identity = inspectDatabase(db);
    if (
      !reconciliarEstoque(db).consistente ||
      !reconciliarComercial(db) ||
      !reconciliarFinanceiro(db)
    )
      throw new BackupError('INVALID_BACKUP');
    const count = (table: string) =>
      Number((db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n);
    const rows = mediaRows(db);
    return {
      databaseId: identity.identity!.identificador,
      rows,
      counts: {
        produtos: count('produtos'),
        clientes: count('clientes'),
        fornecedores: count('fornecedores'),
        vendas: Number(
          (
            db
              .prepare(
                "SELECT count(*) n FROM documentos WHERE tipo='VENDA' AND estado IN ('CONFIRMADO','ESTORNADO')",
              )
              .get() as { n: number }
          ).n,
        ),
        compras: Number(
          (
            db
              .prepare(
                "SELECT count(*) n FROM documentos WHERE tipo='COMPRA' AND estado IN ('CONFIRMADO','ESTORNADO')",
              )
              .get() as { n: number }
          ).n,
        ),
        fotografias: rows.length,
      },
    };
  } finally {
    db.close();
  }
}
function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function encodeManifest(manifest: Manifest) {
  return Buffer.from(canonical({ manifest, sha256: digest(manifest) }));
}
export function decodeManifest(bytes: Buffer): Manifest {
  if (bytes.length > BACKUP_LIMITS.manifestBytes) throw new BackupError('LIMIT');
  try {
    const envelope = record(JSON.parse(bytes.toString('utf8')), ['manifest', 'sha256']);
    if (!Buffer.from(canonical(envelope)).equals(bytes)) throw new BackupError('INVALID_BACKUP');
    const m = record(envelope['manifest'], [
      'app',
      'format',
      'schema',
      'databaseId',
      'appVersion',
      'createdAt',
      'files',
    ]);
    if (m['app'] !== BACKUP_APP) throw new BackupError('INVALID_BACKUP');
    if (m['format'] !== 1 || m['schema'] !== migrations.length)
      throw new BackupError('INCOMPATIBLE');
    checkedId(m['databaseId']);
    if (
      typeof m['appVersion'] !== 'string' ||
      m['appVersion'].length > 100 ||
      typeof m['createdAt'] !== 'string' ||
      new Date(m['createdAt']).toISOString() !== m['createdAt'] ||
      !Array.isArray(m['files']) ||
      !m['files'].length ||
      m['files'].length > BACKUP_LIMITS.entries ||
      envelope['sha256'] !== digest(m)
    )
      throw new BackupError('INVALID_BACKUP');
    const seen = new Set<string>();
    let total = 0;
    for (const raw of m['files']) {
      const f = record(raw, ['path', 'size', 'sha256']);
      if (
        typeof f['path'] !== 'string' ||
        !filePattern.test(f['path']) ||
        seen.has(f['path']) ||
        !Number.isSafeInteger(f['size']) ||
        Number(f['size']) < 1 ||
        !/^[0-9a-f]{64}$/.test(String(f['sha256']))
      )
        throw new BackupError('INVALID_BACKUP');
      if (f['path'].startsWith('images/')) checkedId(f['path'].split('/')[2].split('.')[0]);
      const max = f['path'].startsWith('data/')
        ? BACKUP_LIMITS.databaseBytes
        : f['path'].endsWith('.thumb')
          ? 256 * 1024
          : 8 * 1024 ** 2;
      if (Number(f['size']) > max) throw new BackupError('LIMIT');
      total += Number(f['size']);
      seen.add(f['path']);
    }
    if (total > BACKUP_LIMITS.totalBytes || !seen.has('data/mnr-perfumes.db'))
      throw new BackupError('LIMIT');
    return m as unknown as Manifest;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('INVALID_BACKUP');
  }
}
export async function validateSet(
  root: string,
): Promise<{ manifest: Manifest; summary: BackupSummary }> {
  await safeDirectory(root);
  await safeDirectory(join(root, 'data'));
  await safeDirectory(join(root, 'images'));
  await safeDirectory(join(root, 'images/objects'));
  await regularFile(join(root, 'manifest.json'), BACKUP_LIMITS.manifestBytes);
  const manifest = decodeManifest(await readFile(join(root, 'manifest.json')));
  for (const f of manifest.files) {
    const actual = await hashFile(join(root, f.path));
    if (actual.size !== f.size || actual.sha256 !== f.sha256)
      throw new BackupError('INVALID_BACKUP');
  }
  const info = await databaseInfo(join(root, 'data/mnr-perfumes.db'));
  if (info.databaseId !== manifest.databaseId) throw new BackupError('INVALID_BACKUP');
  const expected = mediaFiles(info.rows),
    actual = manifest.files.filter((f) => f.path.startsWith('images/'));
  if (canonical(expected) !== canonical(actual) || manifest.files.length !== expected.length + 1)
    throw new BackupError('MISSING_PHOTO');
  for (const row of info.rows)
    for (const variant of ['image', 'thumb'] as const) {
      try {
        const header = imageHeader(
          await readFile(join(root, `images/objects/${row.id}.${variant}`)),
        );
        if (
          header.mime !== row.mime ||
          header.width !== (variant === 'image' ? row.largura : row.miniatura_largura) ||
          header.height !== (variant === 'image' ? row.altura : row.miniatura_altura)
        )
          throw new BackupError('MISSING_PHOTO');
      } catch {
        throw new BackupError('MISSING_PHOTO');
      }
    }
  return {
    manifest,
    summary: {
      ...info.counts,
      criadoEm: manifest.createdAt,
      formato: 1,
      schema: manifest.schema,
      versaoAplicativo: manifest.appVersion,
      bytes: manifest.files.reduce((n, f) => n + f.size, 0),
    },
  };
}
async function copyVerified(source: string, target: string, expected: BackupFile, root: string) {
  const before = await regularFile(source, expected?.size ?? BACKUP_LIMITS.databaseBytes);
  await ensureDirectory(dirname(target));
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, encoding, cb) {
      size += chunk.length;
      if (size > before.size) {
        cb(new BackupError('INVALID_BACKUP'));
        return;
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const file = await ownedOutput(root, expected.path);
  try {
    await pipeline(
      createReadStream(source, { highWaterMark: 65536 }),
      meter,
      file.createWriteStream({ autoClose: true }),
    );
  } finally {
    await file.close();
  }
  await syncFile(target);
  const result = { size, sha256: hash.digest('hex') };
  await completeOwned(root, expected.path, result);
  if (
    size !== before.size ||
    (expected && (size !== expected.size || result.sha256 !== expected.sha256))
  )
    throw new BackupError('MISSING_PHOTO');
  return result;
}
export async function captureSet(
  database: string,
  images: string,
  target: string,
  appVersion: string,
) {
  await safeDirectory(images);
  await safeDirectory(join(images, 'objects'));
  const source = await regularFile(database, BACKUP_LIMITS.databaseBytes);
  await spaceFor(dirname(target), source.size * 2);
  await ensureDirectory(join(target, 'data'));
  await ensureDirectory(join(target, 'images/objects'));
  const output = join(target, 'data/mnr-perfumes.db'),
    db = new Database(database, { readonly: true, fileMustExist: true, timeout: 5000 });
  const started = performance.now();
  // SQLite accepts an empty destination. Claim its identity before VACUUM writes.
  const claimed = await ownedOutput(target, 'data/mnr-perfumes.db');
  await claimed.close();
  try {
    db.pragma('trusted_schema=OFF');
    db.pragma('synchronous=FULL');
    db.prepare('VACUUM INTO ?').run(output);
  } finally {
    db.close();
  }
  await syncFile(output);
  const captureMs = performance.now() - started,
    info = await databaseInfo(output),
    files: BackupFile[] = [{ path: 'data/mnr-perfumes.db', ...(await hashFile(output)) }];
  await completeOwned(target, 'data/mnr-perfumes.db', files[0]);
  const photoStarted = performance.now(),
    expected = mediaFiles(info.rows);
  await spaceFor(
    target,
    expected.reduce((sum, f) => sum + f.size, 0),
  );
  for (const f of expected) {
    try {
      await copyVerified(
        join(images, f.path.slice('images/'.length)),
        join(target, f.path),
        f,
        target,
      );
    } catch (error) {
      if (
        ['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'ENODEV', 'EFBIG'].includes(
          String((error as NodeJS.ErrnoException).code),
        )
      )
        throw error;
      throw new BackupError('MISSING_PHOTO');
    }
    files.push(f);
  }
  const photoMs = performance.now() - photoStarted;
  const manifest: Manifest = {
    app: BACKUP_APP,
    format: 1,
    schema: migrations.length,
    databaseId: info.databaseId,
    appVersion,
    createdAt: new Date().toISOString(),
    files,
  };
  const manifestBytes = encodeManifest(manifest),
    manifestFile = await ownedOutput(target, 'manifest.json');
  try {
    await manifestFile.writeFile(manifestBytes);
    await manifestFile.sync();
  } finally {
    await manifestFile.close();
  }
  await completeOwned(target, 'manifest.json', {
    size: manifestBytes.length,
    sha256: createHash('sha256').update(manifestBytes).digest('hex'),
  });
  const result = await validateSet(target);
  return { ...result.summary, captureMs, photoMs };
}
export async function packageSet(root: string, destination: string) {
  const { manifest } = await validateSet(root),
    zip = new yazl.ZipFile();
  const output = await ownedOutput(dirname(destination), basename(destination));
  const completion = pipeline(zip.outputStream, output.createWriteStream({ autoClose: true }));
  zip.on('error', (e) => (zip.outputStream as Readable).destroy(e));
  zip.addFile(join(root, 'manifest.json'), 'manifest.json', { compress: false, mode: 0o100600 });
  for (const file of manifest.files)
    zip.addFile(join(root, file.path), file.path, { compress: false, mode: 0o100600 });
  zip.end();
  try {
    await completion;
  } finally {
    await output.close();
  }
  await syncFile(destination);
  await readArchive(destination);
  const result = await hashFile(destination);
  await completeOwned(dirname(destination), basename(destination), result);
  return result;
}
// This parser never interprets paths from the archive outside this closed grammar.
// STORE-only format rejects decompression bombs instead of allocating expanded data.
export async function readArchive(path: string, destination?: string): Promise<Manifest> {
  const stat = await regularFile(
    path,
    BACKUP_LIMITS.totalBytes + BACKUP_LIMITS.manifestBytes + 100 * 1024 ** 2,
  );
  if (destination) {
    await ensureDirectory(destination);
    await spaceFor(destination, stat.size);
  }
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      path,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (e, z) => (e ? reject(e) : resolve(z!)),
    ),
  );
  const seen = new Map<string, { size: number; sha256: string }>();
  let manifestBytes: Buffer | undefined,
    total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject);
      zip.once('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          const name = entry.fileName,
            mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (
            (name !== 'manifest.json' && !filePattern.test(name)) ||
            seen.has(name) ||
            (mode !== 0 && mode !== 0o100000) ||
            entry.isEncrypted() ||
            entry.compressionMethod !== 0 ||
            entry.compressedSize !== entry.uncompressedSize ||
            entry.generalPurposeBitFlag & 1
          )
            throw new BackupError('INVALID_BACKUP');
          const max =
            name === 'manifest.json'
              ? BACKUP_LIMITS.manifestBytes
              : name.startsWith('data/')
                ? BACKUP_LIMITS.databaseBytes
                : name.endsWith('.thumb')
                  ? 256 * 1024
                  : 8 * 1024 ** 2;
          if (
            !Number.isSafeInteger(entry.uncompressedSize) ||
            entry.uncompressedSize < 1 ||
            entry.uncompressedSize > max ||
            seen.size >= BACKUP_LIMITS.entries + 1
          )
            throw new BackupError('LIMIT');
          seen.set(name, { size: 0, sha256: '' });
          total += entry.uncompressedSize;
          if (total > BACKUP_LIMITS.totalBytes + BACKUP_LIMITS.manifestBytes)
            throw new BackupError('LIMIT');
          const stream = await new Promise<import('node:stream').Readable>((r, j) =>
            zip.openReadStream(entry, (e, s) => (e ? j(e) : r(s!))),
          );
          const hash = createHash('sha256'),
            chunks: Buffer[] = [];
          let size = 0,
            crc = 0;
          const meter = new Transform({
            transform(chunk, encoding, cb) {
              size += chunk.length;
              if (size > entry.uncompressedSize) {
                cb(new BackupError('LIMIT'));
                return;
              }
              hash.update(chunk);
              crc = crc32(chunk, crc);
              if (name === 'manifest.json') chunks.push(chunk);
              cb(null, chunk);
            },
          });
          if (destination) {
            await ensureDirectory(dirname(join(destination, name)));
            const output = await ownedOutput(destination, name);
            try {
              await pipeline(stream, meter, output.createWriteStream({ autoClose: true }));
            } finally {
              await output.close();
            }
            await syncFile(join(destination, name));
          } else
            await pipeline(
              stream,
              meter,
              new Writable({
                write(chunk, encoding, cb) {
                  cb();
                },
              }),
            );
          if (size !== entry.uncompressedSize || crc !== entry.crc32)
            throw new BackupError('INVALID_BACKUP');
          seen.set(name, { size, sha256: hash.digest('hex') });
          if (destination) await completeOwned(destination, name, seen.get(name)!);
          if (name === 'manifest.json') manifestBytes = Buffer.concat(chunks);
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    if (!manifestBytes) throw new BackupError('INVALID_BACKUP');
    const manifest = decodeManifest(manifestBytes);
    if (
      seen.size !== manifest.files.length + 1 ||
      manifest.files.some(
        (f) => seen.get(f.path)?.size !== f.size || seen.get(f.path)?.sha256 !== f.sha256,
      )
    )
      throw new BackupError('INVALID_BACKUP');
    return manifest;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (
      ['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'ENODEV', 'EFBIG', 'ENOENT'].includes(
        String((error as NodeJS.ErrnoException).code),
      )
    )
      throw error;
    throw new BackupError('INVALID_BACKUP');
  } finally {
    zip.close();
  }
}
export async function inspectArchive(source: string, target: string) {
  try {
    await readArchive(source, target);
    await ensureDirectory(join(target, 'images/objects'));
    return (await validateSet(target)).summary;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (['ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'EIO', 'ENODEV', 'EFBIG'].includes(code ?? ''))
      throw error;
    throw new BackupError('INVALID_BACKUP');
  }
}
