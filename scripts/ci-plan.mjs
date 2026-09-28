#!/usr/bin/env node
// Decides which CI jobs a change needs, from the files it touches and the workspace packages
// Turborepo counts as affected (the changed packages and their dependents). Prints GitHub step
// outputs; with --json, a readable summary instead:
//   node scripts/ci-plan.mjs <base-sha> [--json]
// Without a usable base (first push, force push, unknown commit), every job runs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = '', flag] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function knownCommit(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha) || /^0+$/.test(sha)) return false;
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

const services = readdirSync('services').sort();
const everything = !knownCommit(base);
const changed = everything
  ? []
  : git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
const touches = (...patterns) => changed.some((file) => patterns.some((p) => p.test(file)));

// Changes to CI itself or the Node version run every job.
const all =
  everything ||
  touches(/^\.github\/workflows\/(ci|keycloak)\.yml$/, /^\.nvmrc$/, /^scripts\/ci-plan\.mjs$/);

// The clickable HTML prototypes sit inside the packages they design but are not built, tested
// or shipped. Turborepo compares the base with a commit that has their changes reverted, so a
// prototype edit does not count as a change to its package and everything depending on it.
function withoutPrototypes() {
  const prototypes = changed.filter((file) => /(^|\/)prototype\//.test(file));
  if (prototypes.length === 0) return 'HEAD';
  const dir = mkdtempSync(join(tmpdir(), 'ci-plan-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  const gitWith = (...args) => execFileSync('git', args, { encoding: 'utf8', env }).trim();
  try {
    gitWith('read-tree', 'HEAD');
    for (const file of prototypes) {
      const [mode, , sha] = gitWith('ls-tree', base, '--', file).split(/\s+/);
      if (sha) gitWith('update-index', '--add', '--cacheinfo', `${mode},${sha},${file}`);
      else gitWith('update-index', '--force-remove', '--', file);
    }
    return gitWith('commit-tree', gitWith('write-tree'), '-p', 'HEAD', '-m', 'ci-plan');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let affected = [];
if (!all) {
  const turbo = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.turbo;
  const out = execFileSync('npx', ['-y', `turbo@${turbo}`, 'ls', '--affected', '--output=json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TURBO_SCM_BASE: base,
      TURBO_SCM_HEAD: withoutPrototypes(),
      TURBO_TELEMETRY_DISABLED: '1',
    },
  });
  affected = JSON.parse(out).packages.items.map((item) => item.path);
}

const scripts = (path) => JSON.parse(readFileSync(`${path}/package.json`, 'utf8')).scripts ?? {};

// Service images: the affected services, or all of them when their shared build inputs change.
const images =
  all || touches(/^infra\/docker\/service\.Dockerfile$/, /^\.dockerignore$/)
    ? services
    : services.filter((name) => affected.includes(`services/${name}`));

// The Keycloak image (themes, OTP extension) and the realm it imports.
const keycloak =
  all ||
  affected.some((path) => path.startsWith('apps/keycloak-')) ||
  touches(
    /^infra\/docker\/keycloak\.Dockerfile$/,
    /^infra\/compose\/keycloak\//,
    /^scripts\/check-keycloak-realm\.mjs$/,
    /^\.dockerignore$/,
  );

// The integration and sign-in stack suites run against the compose-like stack, the Keycloak
// image and the mocks.
const integration =
  all ||
  keycloak ||
  affected.some((path) => scripts(path)['test:integration'] || scripts(path)['test:stack']) ||
  touches(/^infra\/compose\//, /^mocks\//);

// The mocks export the external contracts in packages/schemas.
const python = all || touches(/^mocks\//, /^packages\/schemas\//);

const plan = { images, keycloak, integration, python };
if (flag === '--json') {
  console.log(JSON.stringify({ base: everything ? null : base, affected, ...plan }, null, 2));
} else {
  console.log(`images=${JSON.stringify(images)}`);
  for (const key of ['keycloak', 'integration', 'python']) console.log(`${key}=${plan[key]}`);
}
