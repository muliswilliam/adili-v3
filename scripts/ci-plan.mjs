#!/usr/bin/env node
// Decides which CI jobs a change needs, from the files it touches and the workspace packages
// Turborepo counts as affected (the changed packages and their dependents). Prints GitHub step
// outputs; with --json, a readable summary instead:
//   node scripts/ci-plan.mjs <base-sha> [--json]
// Without a usable base (first push, force push, unknown commit), every job runs.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

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

let affected = [];
if (!all) {
  const turbo = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies.turbo;
  const out = execFileSync('npx', ['-y', `turbo@${turbo}`, 'ls', '--affected', '--output=json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TURBO_SCM_BASE: base,
      TURBO_SCM_HEAD: 'HEAD',
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
