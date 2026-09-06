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
 * eslint-plugin-import would catch this too, but needs resolver config
 * for React Native's platform extensions (.ios.js, .native.js). This is
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

if (broken.length) {
  console.error(`\n${broken.length} unresolvable import(s):\n`);
  for (const b of broken) console.error(`  ${b}`);
  console.error('\nThese bundle fine and fail as a red screen on the device.\n');
  process.exit(1);
}
console.log(`All relative imports resolve (${files.length} files checked).`);
