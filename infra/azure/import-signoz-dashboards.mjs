#!/usr/bin/env node
// Creates the demo's SigNoz admin once, then imports infra/observability/signoz/*.json.
// Idempotent: a second run logs in and skips a dashboard whose title is already there.
// The password is this host's, mode 600, and is never printed.
//
//   node infra/azure/import-signoz-dashboards.mjs
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const signoz = (process.env.SIGNOZ_URL ?? 'http://127.0.0.1:18088').replace(/\/$/, '');
const email = process.env.SIGNOZ_ADMIN_EMAIL ?? 'signoz-admin@example.com';
const passwordFile =
  process.env.SIGNOZ_ADMIN_PASSWORD_FILE ??
  join(process.env.HOME ?? '/home/adili', '.config/adili/signoz-admin-password');
const dashboardsDir = join(root, 'infra/observability/signoz');

function password() {
  if (!existsSync(passwordFile)) {
    mkdirSync(join(passwordFile, '..'), { recursive: true });
    writeFileSync(passwordFile, `${randomBytes(24).toString('base64url')}\n`, { mode: 0o600 });
    chmodSync(passwordFile, 0o600);
  }
  const value = readFileSync(passwordFile, 'utf8').trim();
  if (value.length < 8) {
    console.error(
      `The SigNoz password in ${passwordFile} is too short; delete it to make a new one.`,
    );
    process.exit(1);
  }
  return value;
}

async function waitForHealth() {
  const deadline = Date.now() + 5 * 60 * 1000;
  let last = 'not up yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${signoz}/api/v1/health`);
      if (response.ok) return;
      last = `health ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.error(`SigNoz did not become healthy at ${signoz}: ${last}`);
  process.exit(1);
}

/** SigNoz serves its API under the /signoz base path, and at the root before that is configured. */
async function api(path, token, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const prefixed = await fetch(`${signoz}/signoz${path}`, { ...init, headers });
  if (prefixed.status !== 404) return prefixed;
  return fetch(`${signoz}${path}`, { ...init, headers });
}

function accessToken(body) {
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'accessJwt' || key === 'accessToken') && typeof item === 'string') {
        found.push(item);
      } else {
        walk(item);
      }
    }
  };
  walk(body);
  return found[0];
}

function orgId(body) {
  const orgs = body?.data?.orgs ?? body?.orgs;
  return Array.isArray(orgs) ? orgs[0]?.id : undefined;
}

function titles(body) {
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.title === 'string') found.push(value.title);
    for (const item of Object.values(value)) walk(item);
  };
  walk(body);
  return found;
}

const adminPassword = password();
await waitForHealth();

const register = await api('/api/v1/register', undefined, {
  method: 'POST',
  body: JSON.stringify({
    name: 'Adili demo',
    email,
    password: adminPassword,
    orgDisplayName: 'Adili',
    orgName: 'adili',
  }),
});
if (!register.ok && register.status !== 400 && register.status !== 409 && register.status !== 422) {
  console.error(`SigNoz registration failed: ${register.status}`);
  process.exit(1);
}

const context = await api('/api/v2/sessions/context');
const org = context.ok ? orgId(await context.json()) : undefined;
const login = await api('/api/v2/sessions/email_password', undefined, {
  method: 'POST',
  body: JSON.stringify({ email, password: adminPassword, ...(org ? { orgId: org } : {}) }),
});
if (!login.ok) {
  console.error(
    `SigNoz login failed: ${login.status}. The password is in ${passwordFile} and was not printed.`,
  );
  process.exit(1);
}
const token = accessToken(await login.json());
if (!token) {
  console.error('SigNoz login answered without an access token.');
  process.exit(1);
}

const existing = titles(await (await api('/api/v1/dashboards', token)).json());
const files = readdirSync(dashboardsDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
for (const name of files) {
  const dashboard = JSON.parse(readFileSync(join(dashboardsDir, name), 'utf8'));
  if (existing.includes(dashboard.title)) {
    console.log(`SigNoz already has ${dashboard.title}`);
    continue;
  }
  // POST keeps only the title. The UI then PUTs the widgets, which is what makes the file show up.
  const created = await api('/api/v1/dashboards', token, {
    method: 'POST',
    body: JSON.stringify({ title: dashboard.title, uploadedGrafana: false }),
  });
  if (!created.ok) {
    console.error(`Import of ${name} failed: ${created.status} ${await created.text()}`);
    process.exit(1);
  }
  const id = (await created.json())?.data?.id;
  if (typeof id !== 'string') {
    console.error(`Import of ${name} did not return a dashboard id.`);
    process.exit(1);
  }
  const saved = await api(`/api/v1/dashboards/${id}`, token, {
    method: 'PUT',
    body: JSON.stringify(dashboard),
  });
  if (!saved.ok) {
    console.error(`Import of ${name} failed: ${saved.status} ${await saved.text()}`);
    process.exit(1);
  }
  console.log(`Imported ${dashboard.title}`);
}
