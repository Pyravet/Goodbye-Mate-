#!/usr/bin/env node
/**
 * Verify every relative import actually resolves.
 *
 * Metro only reports a broken path when the module is REACHED at
 * runtime, so a bad import in a startup file shows up as a red screen on
 * a phone rather than a build failure. That is how `../api/client.js`
 * shipped: it lints clean, it bundles, and it fails only when someone
 * opens the app.
 *
 * Also checks NAMED exports actually exist. Resolving the file is not
 * enough: `import { fetchMe } from './vetsApi.js'` where vetsApi has no
 * fetchMe bundles cleanly and throws "undefined is not a function" the
 * moment the screen renders. That shipped once, and the path-only
 * version of this check passed it.
 *
 * eslint-plugin-import would catch both, but needs resolver config for
 * React Native's platform extensions (.ios.js, .native.js). This is
 * smaller and has no way to be silently misconfigured.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// The extensions Metro tries, in order.
const EXTS = ['', '.js', '.jsx', '.json', '/index.js', '/index.jsx'];

const files = [join(ROOT, 'App.js'), ...walk(join(ROOT, 'src'))];
const broken = [];

for (const file of files) {
  if (!existsSync(file)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = normalize(join(dirname(file), m[1]));
    if (!EXTS.some((e) => existsSync(target + e))) {
      broken.push(`${relative(ROOT, file)} -> ${m[1]}`);
    }
  }
}

// --- named exports ---
//
// A deliberately simple parser: it reads `export function x`,
// `export const x`, and `export { a, b }`. It does NOT follow
// re-exports, so it can produce a false positive on a barrel file —
// which is preferable to missing a real one.
const missing = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const target = normalize(join(dirname(file), m[2]));
    const resolved = EXTS.map((e) => target + e)
      .find((p) => existsSync(p) && statSync(p).isFile());
    if (!resolved) continue;
    const mod = readFileSync(resolved, 'utf8');
    const exported = new Set([
      ...[...mod.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)].map((x) => x[1]),
      ...[...mod.matchAll(/export\s*\{([^}]+)\}/g)]
        .flatMap((x) => x[1].split(',')).map((n) => n.trim().split(/\s+as\s+/).pop().trim()),
    ]);
    if (/export\s+\*/.test(mod)) continue; // re-exports: can't resolve statically
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && !exported.has(name)) {
        missing.push(`${relative(ROOT, file)} imports { ${name} } from ${m[2]} — not exported`);
      }
    }
  }
}

if (missing.length) {
  console.error(`\n${missing.length} missing named export(s):\n`);
  for (const x of missing) console.error(`  ${x}`);
  console.error('\nThese bundle fine and throw "undefined is not a function" on render.\n');
  process.exit(1);
}

if (broken.length) {
  console.error(`\n${broken.length} unresolvable import(s):\n`);
  for (const b of broken) console.error(`  ${b}`);
  console.error('\nThese bundle fine and fail as a red screen on the device.\n');
  process.exit(1);
}
console.log(`All relative imports resolve (${files.length} files checked).`);
