import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });
await build({
  entryPoints: ['src/app.mjs'],
  bundle: true,
  minify: true,
  target: 'es2022',
  format: 'esm',
  outfile: 'dist/app.js',
});
