import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cadastrosV1 } from './migrations/0001-cadastros';
import { estoqueV2 } from './migrations/0002-estoque';
import { comercialV3, commercialTables } from './migrations/0003-comercial';
import { financeiroV4, financeiroTables } from './migrations/0004-financeiro';
import { fotografiasV5 } from './migrations/0005-fotografias';
import { reconciliarEstoque } from '../../services/estoque-reconciliation';
import { reconciliarComercial } from '../../services/comercial-reconciliation';
import { createFotoService } from '../../services/fotos';
import { createMediaSnapshot } from '../../services/media-snapshot';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
export const migrations: readonly Migration[] = [
  cadastrosV1,
  estoqueV2,
  comercialV3,
  financeiroV4,
  fotografiasV5,
];
export const APPLICATION_ID = 0x4d4e5250;
export class DatabaseCompatibilityError extends Error {}
interface AppliedMigration {
  versao: number;
  nome: string;
  checksum: string;
}
interface Identity {
  identificador: string;
  moeda: string;
  metodo_custeio: string;
  versao_regra_custeio: number;
}
const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

export function checkIntegrity(db: Database.Database): void {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok')
    throw new DatabaseCompatibilityError('Falha de integridade; banco preservado.');
  if ((db.pragma('foreign_key_check') as unknown[]).length)
    throw new DatabaseCompatibilityError('Referências inválidas; banco preservado.');
}

// Preflight is read-only: reject unknown/future databases before changing journal mode.
export function inspectDatabase(db: Database.Database, available = migrations) {
  for (const [index, migration] of available.entries()) {
    if (migration.version !== index + 1 || !migration.name || !migration.sql)
      throw new DatabaseCompatibilityError('Lista de migrações inválida.');
  }
  const version = db.pragma('user_version', { simple: true }) as number;
  const applicationId = db.pragma('application_id', { simple: true }) as number;
  const objects = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
  if (version === 0 && applicationId === 0 && objects.length === 0)
    return { version, identity: null };
  if (applicationId !== APPLICATION_ID || version < 1 || version > available.length)
    throw new DatabaseCompatibilityError(
      'Banco desconhecido ou de versão incompatível; preservado.',
    );
  try {
    const requiredTables = [
      'schema_migrations',
      'metadados_banco',
      'operacoes',
      'marcas',
      'categorias',
      'formas_pagamento',
      'clientes',
      'fornecedores',
      'produtos',
      'historico_precos',
      'eventos_auditoria',
    ];
    const tableList = db.pragma('table_list') as { name: string; strict: number }[];
    if (version >= 5) {
      requiredTables.push('foto_arquivos', 'produto_fotos');
      const triggers = db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all() as {
        name: string;
      }[];
      if (
        [...fotografiasV5.sql.matchAll(/CREATE TRIGGER (\w+)/g)].some(
          (m) => !triggers.some((t) => t.name === m[1]),
        )
      )
        throw new Error('Proteção de fotografias ausente');
    }
    if (version >= 4) {
      requiredTables.push(...financeiroTables);
      for (const [kind, pattern] of [
        ['trigger', /CREATE TRIGGER (\w+)/g],
        ['index', /CREATE (?:UNIQUE )?INDEX (\w+)/g],
      ] as const) {
        const actual = db.prepare('SELECT name FROM sqlite_schema WHERE type=?').all(kind) as {
          name: string;
        }[];
        if (
          [...financeiroV4.sql.matchAll(pattern)].some((m) => !actual.some((o) => o.name === m[1]))
        )
          throw new Error('Proteção financeira ausente');
      }
    }
    if (version >= 3 && available[2]?.name === comercialV3.name) {
      requiredTables.push(...commercialTables);
      const expectedTriggers = [...comercialV3.sql.matchAll(/CREATE TRIGGER (\w+)/g)].map(
        (m) => m[1],
      );
      const actual = db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all() as {
        name: string;
      }[];
      if (expectedTriggers.some((name) => !actual.some((trigger) => trigger.name === name)))
        throw new Error('Proteção comercial ausente');
      const expectedIndexes = [...comercialV3.sql.matchAll(/CREATE INDEX (\w+)/g)].map((m) => m[1]);
      const indexes = db.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all() as {
        name: string;
      }[];
      if (expectedIndexes.some((name) => !indexes.some((index) => index.name === name)))
        throw new Error('Índice comercial ausente');
    }
    if (version >= 2 && available[1]?.name === estoqueV2.name) {
      requiredTables.push('saldos_estoque', 'movimentacoes_estoque');
      const triggers = db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all() as {
        name: string;
      }[];
      for (const name of [
        'estoque_saldo_inicial',
        'estoque_produto_criado',
        'estoque_saldo_sem_exclusao',
        'estoque_saldo_protegido',
        'estoque_movimento_imutavel',
        'estoque_movimento_sem_exclusao',
        'estoque_movimento_validar',
        'estoque_movimento_aplicar',
      ]) {
        if (!triggers.some((trigger) => trigger.name === name))
          throw new Error('Proteção de estoque ausente');
      }
    }
    if (
      requiredTables.some(
        (name) => !tableList.some((table) => table.name === name && table.strict === 1),
      )
    )
      throw new Error('Schema incompleto');
    const identities = db.prepare('SELECT * FROM metadados_banco WHERE id = 1').all() as Identity[];
    const identity = identities[0];
    if (
      identities.length !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        identity.identificador,
      ) ||
      identity.moeda !== 'BRL' ||
      identity.metodo_custeio !== 'MEDIA_PONDERADA_MOVEL' ||
      identity.versao_regra_custeio !== 1
    )
      throw new Error('Identidade inválida');
    const applied = db
      .prepare('SELECT versao, nome, checksum FROM schema_migrations ORDER BY versao')
      .all() as AppliedMigration[];
    if (applied.length !== version) throw new Error('Histórico incompleto');
    for (const [index, record] of applied.entries()) {
      const expected = available[index];
      if (
        record.versao !== expected.version ||
        record.nome !== expected.name ||
        record.checksum !== checksum(expected.sql)
      )
        throw new Error('Checksum ou histórico alterado');
    }
    checkIntegrity(db);
    return { version, identity };
  } catch (cause) {
    throw new DatabaseCompatibilityError('Identificação/histórico do banco inválido; preservado.', {
      cause,
    });
  }
}

export async function migrateDatabase(
  db: Database.Database,
  options: { directory: string; existed: boolean; appVersion: string; imagesDirectory?: string },
  available: readonly Migration[] = migrations,
): Promise<void> {
  const initial = inspectDatabase(db, available);
  if (initial.version === available.length) return;
  if (initial.version >= 2 && !reconciliarEstoque(db).consistente)
    throw new DatabaseCompatibilityError(
      'Reconciliação anterior de estoque falhou; banco preservado.',
    );
  if (initial.version >= 3 && !reconciliarComercial(db))
    throw new DatabaseCompatibilityError(
      'Reconciliação comercial anterior falhou; banco preservado.',
    );
  // The application has not registered IPC or exposed any service at this point.
  if (options.existed) {
    const directory = join(options.directory, 'backups');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `pre-migration-${initial.version}-${randomUUID()}.db`);
    if (initial.version >= 5) {
      // No IPC exists during migration; normal runtime snapshots share the live service lock.
      const photos = createFotoService(
        db,
        options.imagesDirectory ?? join(options.directory, 'images'),
        options.appVersion,
        () => {
          throw new Error('Codec indisponível durante backup');
        },
      );
      await createMediaSnapshot(db, photos, path + '.assets', options.appVersion);
    }
    await db.backup(path);
    writeFileSync(
      `${path}.json`,
      JSON.stringify(
        {
          databaseId: initial.identity?.identificador ?? null,
          schemaVersion: initial.version,
          targetSchemaVersion: available.length,
          appVersion: options.appVersion,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { encoding: 'utf8', flag: 'wx' },
    );
  }
  db.transaction(() => {
    // Recheck after asynchronous backup. Never migrate a state different from preflight.
    const current = inspectDatabase(db, available);
    if (
      current.version !== initial.version ||
      current.identity?.identificador !== initial.identity?.identificador
    )
      throw new DatabaseCompatibilityError('Banco mudou durante a preparação; tente novamente.');
    for (const migration of available.slice(current.version)) {
      db.exec(migration.sql);
      if (migration.version === 1) {
        db.prepare(
          `INSERT INTO metadados_banco VALUES (1, ?, ?, 'BRL', 'MEDIA_PONDERADA_MOVEL', 1)`,
        ).run(randomUUID(), new Date().toISOString());
        db.pragma(`application_id = ${APPLICATION_ID}`);
      }
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?, ?)').run(
        migration.version,
        migration.name,
        checksum(migration.sql),
        new Date().toISOString(),
        options.appVersion,
      );
      db.pragma(`user_version = ${migration.version}`);
    }
    checkIntegrity(db);
    if (available[2]?.name === comercialV3.name && !reconciliarEstoque(db).consistente)
      throw new DatabaseCompatibilityError('Reconciliação de estoque falhou; banco preservado.');
    if (available[2]?.name === comercialV3.name && !reconciliarComercial(db))
      throw new DatabaseCompatibilityError('Reconciliação comercial falhou; banco preservado.');
  }).immediate();
}
