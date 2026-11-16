import { appendFileSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export interface FotoDiagnostic {
  phase: string;
  code?: string;
  cause?: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  orientation?: number;
  reductions?: number;
  outputWidth?: number;
  outputHeight?: number;
  ms?: number;
  validationMs?: number;
  decodeMs?: number;
  normalizeMs?: number;
  thumbnailMs?: number;
  encodeMs?: number;
}
export const consoleFotoDiagnostic = (event: FotoDiagnostic) =>
  console.info('PHOTO_DIAGNOSTIC', JSON.stringify(event));

// A bounded operational log, never paths, image bytes, filenames or exception text.
// Logging is best effort and cannot invalidate an import or block application startup.
export function fotoDiagnostics(directory: string) {
  const path = join(directory, 'foto-importacao.jsonl');
  return (event: FotoDiagnostic) => {
    consoleFotoDiagnostic(event);
    try {
      if (existsSync(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return;
      }
      appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      /* Diagnostics never changes the commercial/photo result. */
    }
  };
}
