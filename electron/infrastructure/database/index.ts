import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { inspectDatabase, migrateDatabase } from './migrate';
import { reconciliarEstoque } from '../../services/estoque-reconciliation';
import { EstoqueError } from '../../services/estoque-validation';

export async function openDatabase(
  directory: string,
  appVersion: string,
  onTiming?: (phase: string, durationMs: number) => void,
) {
  const file = join(directory, 'mnr-perfumes.db');
  const existed = existsSync(file);
  const db = new Database(file, { timeout: 5000 });
  try {
    let started = performance.now();
    db.pragma('trusted_schema = OFF');
    db.pragma('foreign_keys = ON');
    inspectDatabase(db);
    onTiming?.('inspectionAndIntegrity', performance.now() - started);
    started = performance.now();
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    onTiming?.('pragmas', performance.now() - started);
    started = performance.now();
    await migrateDatabase(db, { directory, existed, appVersion });
    onTiming?.('migrationIncludingReinspection', performance.now() - started);
    started = performance.now();
    const reconciliation = reconciliarEstoque(db);
    onTiming?.('reconciliation', performance.now() - started);
    if (!reconciliation.consistente)
      throw new EstoqueError('INTEGRITY', 'Reconciliação de estoque falhou; banco preservado.');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
