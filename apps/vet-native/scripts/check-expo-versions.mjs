#!/usr/bin/env node
/**
 * Verify dependency versions against Expo's own pairing map.
 *
 * expo ships bundledNativeModules.json, which states the exact versions
 * an SDK release was built against. It is the ONLY authority on this:
 * every relevant peerDependency in the Expo tree is a wildcard ("*"), so
 * npm installs a mismatched set without a word of complaint.
 *
 * That is how react-native 0.87.1 got in against SDK 57, which needs
 * 0.86.3. The symptom was Metro failing to start on a missing
 * `rn-get-polyfills` — a file 0.87 no longer ships and metro-config
 * still requires. Nothing in lint, install, or the bundle catches it;
 * it fails when someone runs the app.
 *
 * Skipped when node_modules is absent, so it never blocks a fresh clone.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAP = join(ROOT, 'node_modules/expo/bundledNativeModules.json');

if (!existsSync(MAP)) {
  console.log('expo not installed — skipping version check.');
  process.exit(0);
}

const bundled = JSON.parse(readFileSync(MAP, 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const wrong = [];
for (const [name, want] of Object.entries(bundled)) {
  const have = pkg.dependencies?.[name];
  if (have && have !== want) wrong.push({ name, have, want });
}

if (wrong.length) {
  console.error(`\n${wrong.length} package(s) do not match Expo SDK ${pkg.dependencies.expo}:\n`);
  for (const w of wrong) console.error(`  ${w.name.padEnd(34)} ${w.have}  ->  ${w.want}`);
  console.error('\nExpo peer deps are wildcards, so npm will install these happily.');
  console.error('They fail when Metro starts, not when you install.\n');
  process.exit(1);
}
console.log(`All ${Object.keys(pkg.dependencies).length} dependencies match Expo's bundled versions.`);
