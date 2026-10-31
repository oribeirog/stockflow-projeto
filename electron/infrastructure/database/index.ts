import Database from 'better-sqlite3';
import { join } from 'node:path';
export function openDatabase(directory: string) {
  const db = new Database(join(directory, 'mnr-perfumes.db'), { timeout: 5000 });
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.prepare('SELECT 1 AS ready').get();
  return db;
}
