import esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';

const result = await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  sourcemap: true,
  metafile: true
});
writeFileSync('dist/extension.meta.json', JSON.stringify(result.metafile));
