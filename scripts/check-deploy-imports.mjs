#!/usr/bin/env node
// Checks that a `pnpm deploy --prod` output can load its code: every package a compiled file
// imports, in the service's dist/ and in the dist/ of each workspace package it installed, must
// resolve from the production install, so a runtime dependency declared as a devDependency fails
// here rather than when the image starts. Resolves only; runs nothing.
//   node --experimental-import-meta-resolve scripts/check-deploy-imports.mjs <deploy-dir>
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const builtins = new Set(builtinModules);
// Static and dynamic imports with a literal specifier, as tsc emits them.
const specifiers = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"\s]+)['"]/g;

// The service, then each workspace package in pnpm's store (`@adili+<name>@file+...`).
const store = join(root, 'node_modules/.pnpm');
const packages = [
  root,
  ...readdirSync(store)
    .filter((entry) => entry.startsWith('@adili+'))
    .map((entry) => join(store, entry, 'node_modules/@adili', entry.slice(7).split('@')[0])),
].map((dir) => realpathSync(dir));

const files = packages
  .filter((dir) => existsSync(join(dir, 'dist')))
  .flatMap((dir) => readdirSync(join(dir, 'dist'), { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name));

const missing = new Set();
for (const file of files) {
  for (const [, specifier] of readFileSync(file, 'utf8').matchAll(specifiers)) {
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
    if (builtins.has(specifier.split('/')[0])) continue;
    try {
      import.meta.resolve(specifier, pathToFileURL(file));
    } catch {
      missing.add(`${specifier} (${file})`);
    }
  }
}

if (missing.size > 0) {
  console.error(`Imports that do not resolve from the production install in ${root}:`);
  for (const entry of missing) console.error(`  ${entry}`);
  process.exit(1);
}
console.log(`${files.length} files in ${packages.length} packages resolve their imports`);
