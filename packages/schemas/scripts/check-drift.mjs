#!/usr/bin/env node
// Internal contract drift. A service that serves an internal API has a `contracts` script that
// writes its OpenAPI document to packages/schemas/internal/<service>.yaml, the one committed
// contract per service (clients such as the console are generated from it). This runs each
// export into a temporary file with `--out` and fails when it differs from the committed file.
//
// Run through `pnpm contracts:drift` at the repo root, which builds the services' workspace
// dependencies first. SKIP_CONTRACT_DRIFT=1 skips the check.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function hasContractsScript(dir) {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  return Boolean(JSON.parse(readFileSync(manifest, 'utf8')).scripts?.contracts);
}

const services = existsSync(servicesDir)
  ? readdirSync(servicesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasContractsScript(join(servicesDir, entry.name)))
      .map((entry) => entry.name)
  : [];

if (services.length === 0) {
  console.log('No service has a `contracts` script yet; skipping internal contract drift.');
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'adili-contracts-'));
let failed = 0;
try {
  for (const name of services) {
    const expected = join(internalDir, `${name}.yaml`);
    const exported = join(scratch, `${name}.yaml`);
    const run = spawnSync('pnpm', ['run', '--silent', 'contracts', '--out', exported], {
      cwd: join(servicesDir, name),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    if (run.status !== 0 || !existsSync(exported)) {
      failed += 1;
      console.error(`fail  ${name}: the contracts export did not run (exit ${run.status})`);
      continue;
    }
    if (!existsSync(expected)) {
      failed += 1;
      console.error(
        `fail  ${name}: ${expected} is missing; run pnpm --filter @adili/${name} contracts`,
      );
      continue;
    }
    if (readFileSync(exported, 'utf8') === readFileSync(expected, 'utf8')) {
      console.log(`ok    ${name}`);
    } else {
      failed += 1;
      console.error(
        `fail  ${name}: the service's OpenAPI differs from packages/schemas/internal/${name}.yaml; run pnpm --filter @adili/${name} contracts and commit the result`,
      );
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
