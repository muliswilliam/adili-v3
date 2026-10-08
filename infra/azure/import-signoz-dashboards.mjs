#!/usr/bin/env node
// Creates the demo's SigNoz admin once, then imports infra/observability/signoz/*.json
// and the error alerts in infra/observability/signoz/alerts/*.json.
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
const alertsDir = join(dashboardsDir, 'alerts');

/** SigNoz rejects a password without each of these. base64url can miss one of them. */
function acceptablePassword(value) {
  return (
    value.length >= 12 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[~!@#$%^&*()_+\-={}|[\]:<>?,./]/.test(value)
  );
}

function newPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let value = '';
  while (!acceptablePassword(value)) {
    value = `Aa1!${Array.from(randomBytes(24), (byte) => alphabet[byte % alphabet.length]).join('')}`;
  }
  return value;
}

function password() {
  mkdirSync(join(passwordFile, '..'), { recursive: true });
  const current = existsSync(passwordFile) ? readFileSync(passwordFile, 'utf8').trim() : '';
  // Only replace a password SigNoz would reject. A valid one may already be the admin's.
  if (!acceptablePassword(current)) {
    writeFileSync(passwordFile, `${newPassword()}\n`, { mode: 0o600 });
    chmodSync(passwordFile, 0o600);
  }
  return readFileSync(passwordFile, 'utf8').trim();
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
    if (value.display && typeof value.display.name === 'string') found.push(value.display.name);
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
if (!register.ok) {
  console.log(`SigNoz registration answered ${register.status}`);
}

const context = await api(`/api/v2/sessions/context?email=${encodeURIComponent(email)}`);
const org = context.ok ? orgId(await context.json()) : undefined;
const login = await api('/api/v2/sessions/email_password', undefined, {
  method: 'POST',
  body: JSON.stringify({ email, password: adminPassword, ...(org ? { orgId: org } : {}) }),
});
if (!login.ok) {
  const loginText = (await login.text()).replaceAll(adminPassword, '[redacted]');
  console.error(
    `SigNoz login failed: ${login.status} ${loginText}. The password is in ${passwordFile} and was not printed.`,
  );
  process.exit(1);
}
const token = accessToken(await login.json());
if (!token) {
  console.error('SigNoz login answered without an access token.');
  process.exit(1);
}

const listed = await api('/api/v2/dashboards', token);
if (!listed.ok) {
  console.error(`SigNoz dashboard list failed: ${listed.status} ${await listed.text()}`);
  process.exit(1);
}
const existing = titles(await listed.json());
const files = readdirSync(dashboardsDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
for (const name of files) {
  const dashboard = JSON.parse(readFileSync(join(dashboardsDir, name), 'utf8'));
  if (existing.includes(dashboard.title)) {
    console.log(`SigNoz already has ${dashboard.title}`);
    continue;
  }
  // A string `version` and no `schemaVersion` is a v1 dashboard. SigNoz migrates that to its
  // current format when it is posted to the v2 create route.
  const created = await api('/api/v2/dashboards', token, {
    method: 'POST',
    body: JSON.stringify({ ...dashboard, version: dashboard.version ?? 'v4' }),
  });
  if (!created.ok) {
    console.error(`Import of ${name} failed: ${created.status} ${await created.text()}`);
    process.exit(1);
  }
  console.log(`Imported ${dashboard.title}`);
}

function alertNames(body) {
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.alert === 'string') found.push(value.alert);
    for (const item of Object.values(value)) walk(item);
  };
  walk(body);
  return found;
}

// SigNoz will not store a rule that names no channel. This webhook stays on the VM.
// The Alerts page is where a firing rule shows; nothing is emailed.
const channelName = 'Adili alerts';
const channels = await api('/api/v1/channels', token);
if (!channels.ok) {
  console.error(`SigNoz channel list failed: ${channels.status} ${await channels.text()}`);
  process.exit(1);
}
const channelBody = await channels.json();
const channelList = channelBody?.data ?? channelBody?.channels ?? [];
const hasChannel =
  Array.isArray(channelList) &&
  channelList.some(
    (channel) => channel?.name === channelName || channel?.displayName === channelName,
  );
if (!hasChannel) {
  const createdChannel = await api('/api/v1/channels', token, {
    method: 'POST',
    body: JSON.stringify({
      name: channelName,
      webhook_configs: [{ send_resolved: false, url: 'http://127.0.0.1:18088/api/v1/health' }],
    }),
  });
  if (!createdChannel.ok) {
    console.error(
      `SigNoz channel create failed: ${createdChannel.status} ${await createdChannel.text()}`,
    );
    process.exit(1);
  }
  console.log(`Created SigNoz channel ${channelName}`);
}

const rules = await api('/api/v1/rules', token);
if (!rules.ok) {
  console.error(`SigNoz alert list failed: ${rules.status} ${await rules.text()}`);
  process.exit(1);
}
const existingAlerts = alertNames(await rules.json());
const alertFiles = existsSync(alertsDir)
  ? readdirSync(alertsDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  : [];
for (const name of alertFiles) {
  const rule = JSON.parse(readFileSync(join(alertsDir, name), 'utf8'));
  if (existingAlerts.includes(rule.alert)) {
    console.log(`SigNoz already has ${rule.alert}`);
    continue;
  }
  const created = await api('/api/v1/rules', token, {
    method: 'POST',
    body: JSON.stringify(rule),
  });
  if (!created.ok) {
    console.error(`Import of ${name} failed: ${created.status} ${await created.text()}`);
    process.exit(1);
  }
  console.log(`Imported ${rule.alert}`);
}
