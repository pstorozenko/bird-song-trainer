import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Writes dist/sw.js from src/sw.template.js after the build, with a precache list of every
 * built file except recordings (those are cached on demand) and a version hash of their contents,
 * so any change to the app, data or photos ships a new service worker.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  let root = '.';
  return {
    name: 'bird-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const full = join(dir, name);
          return statSync(full).isDirectory() ? walk(full) : [full];
        });
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => !f.startsWith('audio/') && f !== 'sw.js')
        .sort();
      const template = readFileSync(resolve(root, 'src/sw.template.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = template
        .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(['./', ...files])};`);
      if (sw.includes('__VERSION__') || sw.includes('__PRECACHE__')) throw new Error('sw.js placeholders not replaced');
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`sw.js: version ${version}, ${files.length} files precached`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
});
