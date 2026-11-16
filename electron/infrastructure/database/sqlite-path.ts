import { resolve, toNamespacedPath } from 'node:path';

// SQLite's Windows VFS does not automatically apply Node's long-path prefix.
// Migration protections contain nested exclusive staging directories. Keep the
// ordinary path elsewhere; normalize only the filename passed to SQLite itself.
export function sqlitePath(file: string): string {
  if (process.platform !== 'win32' || file === ':memory:') return file;
  const absolute = resolve(file);
  return absolute.length >= 240 ? toNamespacedPath(absolute) : file;
}
