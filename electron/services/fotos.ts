import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  existsSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  readFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { ImagemFoto, PreparacaoFoto, VinculoFoto } from '../../shared/fotos';
import { record, text, identifier, canonical, CadastroError } from './catalog-validation';
import { FotoError } from './foto-validation';

export interface FotoNormalizada {
  mime: 'image/png' | 'image/jpeg';
  image: Buffer;
  thumb: Buffer;
  size: { width: number; height: number };
  thumbSize: { width: number; height: number };
}
export interface FotoArquivo {
  id: string;
  mime: 'image/png' | 'image/jpeg';
  largura: number;
  altura: number;
  tamanho: number;
  hash: string;
  miniatura_tamanho: number;
  miniatura_hash: string;
  miniatura_largura: number;
  miniatura_altura: number;
  criado_em: string;
  expira_em: string;
  estado: 'PREPARADA' | 'PUBLICADA' | 'RETIRADA';
}
export const fotoHash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export const fotoId = (value: unknown): string => {
  const id = text(value, 'foto', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    throw new FotoError('PHOTO_INVALID');
  return id;
};

export function createFotoService(
  db: Database.Database,
  directory: string,
  appVersion: string,
  normalize: (bytes: Buffer) => FotoNormalizada,
  options: { now?: () => number; fault?: (phase: string) => void } = {},
) {
  const root = resolve(directory),
    staged = join(root, 'staging'),
    objects = join(root, 'objects');
  const now = options.now ?? Date.now;
  const owners = new Map<string, number>();
  let tail: Promise<unknown> = Promise.resolve();
  function safeDirectories() {
    for (const dir of [root, staged, objects]) {
      if (
        lstatSync(dir).isSymbolicLink() ||
        !lstatSync(dir).isDirectory() ||
        resolve(realpathSync(dir)).toLowerCase() !== dir.toLowerCase()
      )
        throw new FotoError('PHOTO_UNAVAILABLE');
    }
  }
  for (const dir of [root, staged, objects]) mkdirSync(dir, { recursive: true });
  safeDirectories();
  function withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    const pending = tail.then(operation);
    tail = pending.catch(() => undefined);
    return pending;
  }
  function pathFor(row: FotoArquivo, variant: 'image' | 'thumb', stage = false) {
    fotoId(row.id);
    return join(stage ? staged : objects, `${row.id}.${variant}`);
  }
  function verified(row: FotoArquivo, variant: 'image' | 'thumb', stage = false): Buffer {
    safeDirectories();
    const path = pathFor(row, variant, stage),
      stat = lstatSync(path);
    const size = variant === 'image' ? row.tamanho : row.miniatura_tamanho;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== size)
      throw new FotoError('PHOTO_UNAVAILABLE');
    const bytes = readFileSync(path);
    if (
      bytes.length !== size ||
      fotoHash(bytes) !== (variant === 'image' ? row.hash : row.miniatura_hash)
    )
      throw new FotoError('PHOTO_UNAVAILABLE');
    return bytes;
  }
  function durable(path: string, bytes: Buffer) {
    const fd = openSync(path, 'wx');
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  function rowFor(id: string) {
    return db.prepare('SELECT * FROM foto_arquivos WHERE id=?').get(fotoId(id)) as
      | FotoArquivo
      | undefined;
  }
  function product(id: unknown) {
    const value = identifier(id);
    if (!db.prepare('SELECT 1 FROM produtos WHERE id=?').get(value))
      throw new CadastroError('NOT_FOUND', 'Produto indisponível');
    return value;
  }
  function cleanupRow(row: FotoArquivo) {
    // Database ledger proves ownership. A filename alone never authorizes deletion.
    if (db.prepare('SELECT 1 FROM produto_fotos WHERE foto_id=?').get(row.id)) return;
    if (
      row.estado !== 'RETIRADA' &&
      !(row.estado === 'PREPARADA' && Date.parse(row.expira_em) <= now())
    )
      return;
    for (const stage of [true, false])
      for (const variant of ['image', 'thumb'] as const) {
        const path = pathFor(row, variant, stage);
        if (!existsSync(path)) continue;
        verified(row, variant, stage);
        if (db.prepare('SELECT 1 FROM produto_fotos WHERE foto_id=?').get(row.id)) return;
        options.fault?.('cleanup');
        unlinkSync(path);
      }
    owners.delete(row.id);
  }
  function reconcile() {
    safeDirectories();
    let preserved = 0,
      missing = 0;
    const rows = db.prepare('SELECT * FROM foto_arquivos').all() as FotoArquivo[];
    for (const row of rows) {
      if (db.prepare('SELECT 1 FROM produto_fotos WHERE foto_id=?').get(row.id)) {
        try {
          verified(row, 'image');
          verified(row, 'thumb');
        } catch {
          missing++;
        }
      } else {
        if (row.estado === 'PUBLICADA') preserved++;
        try {
          cleanupRow(row);
        } catch {
          preserved++;
        }
      }
    }
    const known = new Set(rows.flatMap((r) => [`${r.id}.image`, `${r.id}.thumb`]));
    for (const folder of [staged, objects])
      preserved += readdirSync(folder).filter((name) => !known.has(name)).length;
    return { preserved, missing };
  }
  function prepare(bytes: Buffer, owner: number): Promise<PreparacaoFoto> {
    return withLock(() => {
      safeDirectories();
      const image = normalize(bytes),
        id = randomUUID();
      const row: FotoArquivo = {
        id,
        mime: image.mime,
        largura: image.size.width,
        altura: image.size.height,
        tamanho: image.image.length,
        hash: fotoHash(image.image),
        miniatura_tamanho: image.thumb.length,
        miniatura_hash: fotoHash(image.thumb),
        miniatura_largura: image.thumbSize.width,
        miniatura_altura: image.thumbSize.height,
        criado_em: new Date(now()).toISOString(),
        expira_em: new Date(now() + 30 * 60_000).toISOString(),
        estado: 'PREPARADA',
      };
      db.prepare(
        'INSERT INTO foto_arquivos (id,mime,largura,altura,tamanho,hash,miniatura_tamanho,miniatura_hash,miniatura_largura,miniatura_altura,criado_em,expira_em,estado) VALUES (@id,@mime,@largura,@altura,@tamanho,@hash,@miniatura_tamanho,@miniatura_hash,@miniatura_largura,@miniatura_altura,@criado_em,@expira_em,@estado)',
      ).run(row);
      durable(pathFor(row, 'image', true), image.image);
      durable(pathFor(row, 'thumb', true), image.thumb);
      owners.set(id, owner);
      return {
        token: id,
        previa: {
          fotoId: id,
          mime: row.mime,
          bytes: new Uint8Array(image.thumb),
          largura: row.miniatura_largura,
          altura: row.miniatura_altura,
        },
      };
    });
  }
  function obtain(input: unknown): ImagemFoto | null {
    const value = record(input, ['produtoId', 'variante']);
    const id = product(value['produtoId']);
    if (!['miniatura', 'imagem'].includes(value['variante'] as string))
      throw new FotoError('PHOTO_INVALID');
    const row = db
      .prepare(
        'SELECT a.* FROM foto_arquivos a JOIN produto_fotos p ON p.foto_id=a.id WHERE p.produto_id=?',
      )
      .get(id) as FotoArquivo | undefined;
    if (!row) return null;
    const mini = value['variante'] === 'miniatura';
    try {
      return {
        fotoId: row.id,
        mime: row.mime,
        bytes: new Uint8Array(verified(row, mini ? 'thumb' : 'image')),
        largura: mini ? row.miniatura_largura : row.largura,
        altura: mini ? row.miniatura_altura : row.altura,
      };
    } catch {
      throw new FotoError('PHOTO_UNAVAILABLE');
    }
  }
  function mutate(command: unknown, owner: number, removing: boolean): Promise<VinculoFoto> {
    return withLock(() => {
      safeDirectories();
      const envelope = record(command, ['operacaoId', 'motivo', 'dados']);
      const operationId = text(envelope['operacaoId'], 'operacaoId', 100);
      if (!/^[A-Za-z0-9_-]+$/.test(operationId))
        throw new CadastroError('VALIDATION', 'Operação inválida');
      const reason = text(envelope['motivo'], 'motivo', 4000);
      const data = record(envelope['dados'], removing ? ['produtoId'] : ['produtoId', 'token']);
      const id = identifier(data['produtoId']),
        token = removing ? null : fotoId(data['token']);
      const kind = removing ? 'FOTO_REMOVER' : 'FOTO_SALVAR';
      const hash = fotoHash(Buffer.from(canonical({ version: 1, kind, id, token, reason })));
      const previous = db
        .prepare('SELECT tipo,hash_entrada,resultado_json FROM operacoes WHERE id=?')
        .get(operationId) as
        | { tipo: string; hash_entrada: string; resultado_json: string }
        | undefined;
      if (previous) {
        if (previous.tipo !== kind || previous.hash_entrada !== hash)
          throw new CadastroError('IDEMPOTENCY_CONFLICT', 'Operação conflitante');
        return JSON.parse(previous.resultado_json) as VinculoFoto;
      }
      product(id);
      const row = token ? rowFor(token) : undefined;
      if (
        token &&
        (!row ||
          row.estado !== 'PREPARADA' ||
          owners.get(token) !== owner ||
          Date.parse(row.expira_em) <= now())
      )
        throw new FotoError('PHOTO_EXPIRED');
      if (row) {
        // A retry after partial publication verifies and reuses already published files.
        for (const variant of ['image', 'thumb'] as const) {
          if (!existsSync(pathFor(row, variant))) {
            verified(row, variant, true);
            renameSync(pathFor(row, variant, true), pathFor(row, variant));
          }
          verified(row, variant);
          options.fault?.('publish-' + variant);
        }
        options.fault?.('published');
      }
      const result: VinculoFoto = { produtoId: id, fotoId: token };
      let oldId: string | undefined;
      db.transaction(() => {
        const old = db.prepare('SELECT foto_id FROM produto_fotos WHERE produto_id=?').get(id) as
          | { foto_id: string }
          | undefined;
        oldId = old?.foto_id;
        const date = new Date(now()).toISOString();
        db.prepare('INSERT INTO operacoes VALUES (?,?,?,?,?)').run(
          operationId,
          kind,
          hash,
          'null',
          date,
        );
        if (row) {
          db.prepare("UPDATE foto_arquivos SET estado='PUBLICADA' WHERE id=?").run(row.id);
          db.prepare(
            'INSERT INTO produto_fotos VALUES (?,?,?) ON CONFLICT(produto_id) DO UPDATE SET foto_id=excluded.foto_id,atualizado_em=excluded.atualizado_em',
          ).run(id, row.id, date);
        } else db.prepare('DELETE FROM produto_fotos WHERE produto_id=?').run(id);
        if (oldId && oldId !== token)
          db.prepare("UPDATE foto_arquivos SET estado='RETIRADA' WHERE id=?").run(oldId);
        db.prepare(
          `INSERT INTO eventos_auditoria (operacao_id,produto_id,evento,motivo,antes_json,depois_json,registrado_em,versao_aplicativo) VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          operationId,
          id,
          kind,
          reason,
          JSON.stringify({ fotoId: oldId ?? null }),
          JSON.stringify(result),
          date,
          appVersion,
        );
        db.prepare('UPDATE operacoes SET resultado_json=? WHERE id=?').run(
          JSON.stringify(result),
          operationId,
        );
        options.fault?.('before-commit');
      }).immediate();
      options.fault?.('after-commit');
      if (token) owners.delete(token);
      if (oldId) {
        const old = rowFor(oldId);
        if (old) {
          try {
            cleanupRow(old);
          } catch {
            /* Retain uncertain files. Reconciliation retries safely. */
          }
        }
      }
      return result;
    });
  }
  function discard(token: unknown, owner: number) {
    return withLock(() => {
      const id = fotoId(token),
        row = rowFor(id);
      if (!row || owners.get(id) !== owner || row.estado !== 'PREPARADA') return null;
      db.prepare("UPDATE foto_arquivos SET estado='RETIRADA' WHERE id=?").run(id);
      cleanupRow({ ...row, estado: 'RETIRADA' });
      return null;
    });
  }
  return {
    directory: root,
    withLock,
    prepare,
    obtain,
    save: (command: unknown, owner: number) => mutate(command, owner, false),
    remove: (command: unknown, owner: number) => mutate(command, owner, true),
    discard,
    reconcile: () => withLock(reconcile),
    verified,
  };
}
export type FotoService = ReturnType<typeof createFotoService>;
