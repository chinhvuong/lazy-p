import * as esbuild from 'esbuild';
import { argv } from 'process';

const watch = argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  outdir: 'dist',
  logLevel: 'info',
};

const ctx = await esbuild.context({
  ...shared,
  entryPoints: [
    'src/content.ts',
    'src/background.ts',
    'src/popup.ts',
  ],
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
