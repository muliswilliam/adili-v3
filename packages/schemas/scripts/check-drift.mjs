#!/usr/bin/env node
// Internal contract drift, in two steps.
//
// 1. A service that serves an internal API has a `contracts` script that writes its OpenAPI
//    document to packages/schemas/internal/<service>.yaml, the one committed contract per service.
//    This runs each export into a temporary file with `--out` and fails when it differs from the
//    committed file.
// 2. Consumers (apps and services) generate typed clients from the committed contracts with
//    `openapi-typescript <contract> -o <file>.gen.ts` in their package scripts. This runs each of
//    those generations into a temporary file and fails when it differs from the committed client,
//    so a client left stale after a contract change is caught here, not only in CI's diff.
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

const workspaceDirs = ['apps', 'services', 'packages'].flatMap((group) => {
  const dir = join(repoRoot, group);
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name))
    : [];
});

const services = existsSync(servicesDir)
  ? readdirSync(servicesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasContractsScript(join(servicesDir, entry.name)))
      .map((entry) => entry.name)
  : [];

/** `openapi-typescript <input> -o <output>` generations in a package's scripts. */
const GENERATION = /openapi-typescript\s+(\S+)\s+-o\s+(\S+\.gen\.ts)/g;

function generatedClients(dir) {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return [];
  const { name, scripts = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
  return Object.values(scripts).flatMap((script) =>
    [...script.matchAll(GENERATION)].map(([, input, output]) => ({ name, dir, input, output })),
  );
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

  // A generation named by two scripts is checked once.
  const clients = [
    ...new Map(
      workspaceDirs
        .flatMap(generatedClients)
        .map((client) => [join(client.dir, client.output), client]),
    ).values(),
  ];
  for (const [index, { name, dir, input, output }] of clients.entries()) {
    const label = `${name} ${output}`;
    const generated = join(scratch, `client-${String(index)}.gen.ts`);
    const run = spawnSync('pnpm', ['exec', 'openapi-typescript', input, '-o', generated], {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const committed = join(dir, output);
    if (run.status !== 0 || !existsSync(generated)) {
      failed += 1;
      console.error(`fail  ${label}: openapi-typescript did not run (exit ${run.status})`);
    } else if (
      !existsSync(committed) ||
      readFileSync(generated, 'utf8') !== readFileSync(committed, 'utf8')
    ) {
      failed += 1;
      console.error(
        `fail  ${label}: stale client of ${input.replace(/^.*\/internal\//, '')}; run the package's generate script (or its typecheck) and commit the result`,
      );
    } else {
      console.log(`ok    ${label}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
