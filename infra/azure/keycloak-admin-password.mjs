#!/usr/bin/env node
// Sets the Azure demo's Keycloak master admin password to this host's own random one (in
// ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE, created by demo-vault.sh) in place of the bootstrap
// admin_dev that docker-compose.yml starts Keycloak with. Idempotent: does nothing once the host's
// password works, and sets it again after anything brought admin_dev back (a fresh Keycloak
// database, or a restore of one from before). Talks to Keycloak on loopback only; never prints
// either password.
//
//   KEYCLOAK_URL=http://127.0.0.1:18080 node infra/azure/keycloak-admin-password.mjs
import { readFileSync } from 'node:fs';

const base = (process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const username = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const file = process.env.ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE;
/** What docker-compose.yml bootstraps the master admin with. */
const BOOTSTRAP_PASSWORD = 'admin_dev';

if (!file) {
  console.error('Set ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE (source infra/azure/demo-vault.sh).');
  process.exit(1);
}
const password = readFileSync(file, 'utf8').trim();
if (password.length < 24) {
  console.error(
    `The Keycloak admin password in ${file} is too short; delete it to make a new one.`,
  );
  process.exit(1);
}

/** A master admin token for this password, or undefined when Keycloak refuses it. */
async function token(candidate) {
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username,
      password: candidate,
    }),
  });
  const body = await response.json().catch(() => ({}));
  // Keycloak answers a wrong password with 400 or 401 and `invalid_grant`.
  if (body.error === 'invalid_grant') return undefined;
  if (!response.ok) throw new Error(`Keycloak admin token: HTTP ${response.status}`);
  return body.access_token;
}

async function admin(path, accessToken, init = {}) {
  const response = await fetch(`${base}/admin/realms/master${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Keycloak admin ${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

/** Deploy runs this right after compose up: wait for Keycloak to answer, up to 3 minutes. */
async function waitForKeycloak() {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${base}/realms/master`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (attempt >= 36) throw new Error(`Keycloak at ${base} did not answer within 3 minutes`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

await waitForKeycloak();
if (await token(password)) {
  console.log("Keycloak admin already uses this host's password.");
  process.exit(0);
}
const bootstrap = await token(BOOTSTRAP_PASSWORD);
if (!bootstrap) {
  console.error(
    "Keycloak refuses both this host's admin password and the bootstrap one; " +
      'reset it by hand (kcadm on the loopback) and rerun.',
  );
  process.exit(1);
}
const [user] = await admin(`/users?exact=true&username=${encodeURIComponent(username)}`, bootstrap);
if (!user) throw new Error(`No master user ${username}`);
await admin(`/users/${user.id}/reset-password`, bootstrap, {
  method: 'PUT',
  body: JSON.stringify({ type: 'password', value: password, temporary: false }),
});
if (!(await token(password))) throw new Error('The new Keycloak admin password does not work');
console.log("Keycloak admin now uses this host's password (admin_dev no longer works).");
