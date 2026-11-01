import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { inspectDatabase, migrateDatabase } from './migrate';

export async function openDatabase(directory: string, appVersion: string) {
  const file = join(directory, 'mnr-perfumes.db');
  const existed = existsSync(file);
  const db = new Database(file, { timeout: 5000 });
  try {
    db.pragma('foreign_keys = ON');
    inspectDatabase(db);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    await migrateDatabase(db, { directory, existed, appVersion });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
