import { build } from 'esbuild';
await build({
  entryPoints: ['electron/preload/index.ts'],
  outfile: 'dist/electron/preload/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node24',
});
