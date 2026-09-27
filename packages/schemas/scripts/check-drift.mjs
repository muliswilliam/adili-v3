#!/usr/bin/env node
// Hook for contract-convergence tickets. A service that exports its live OpenAPI
// writes services/<name>/openapi.export.yaml; this compares it to the draft in
// packages/schemas/internal/<name>.yaml. Until those exports exist, skip.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const servicesDir = join(repoRoot, 'services');
const internalDir = join(here, '..', 'internal');

if (process.env.SKIP_CONTRACT_DRIFT === '1') {
  console.log('SKIP_CONTRACT_DRIFT=1; skipping internal contract drift check.');
  process.exit(0);
}

const services = existsSync(servicesDir)
  ? readdirSync(servicesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const exports = [];
for (const name of services) {
  const exported = join(servicesDir, name, 'openapi.export.yaml');
  if (existsSync(exported)) {
    exports.push({ name, exported, expected: join(internalDir, `${name}.yaml`) });
  }
}

if (exports.length === 0) {
  console.log(
    'No services/*/openapi.export.yaml yet; skipping internal contract drift. Convergence tickets add that file.',
  );
  process.exit(0);
}

let failed = 0;
for (const { name, exported, expected } of exports) {
  if (!existsSync(expected)) {
    failed += 1;
    console.error(`fail  ${name}: export exists but ${expected} is missing`);
    continue;
  }
  const left = readFileSync(exported, 'utf8');
  const right = readFileSync(expected, 'utf8');
  if (left === right) {
    console.log(`ok    ${name}`);
  } else {
    failed += 1;
    console.error(`fail  ${name}: ${exported} differs from ${expected}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
