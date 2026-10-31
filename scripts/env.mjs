import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
export function environment(extra = {}) {
  const cache = resolve('.cache');
  const temp = resolve('.cache/tmp');
  mkdirSync(temp, { recursive: true });
  const env = {
    ...process.env,
    TEMP: temp,
    TMP: temp,
    ELECTRON_CACHE: resolve(cache, 'electron'),
    ELECTRON_BUILDER_CACHE: resolve(cache, 'builder'),
    ...extra,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
