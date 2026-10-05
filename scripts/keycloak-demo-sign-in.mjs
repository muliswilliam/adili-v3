#!/usr/bin/env node
// Applies demo sign-in (#616) to a running Keycloak whose adili realm was imported before it
// existed: Keycloak imports the realm file only when the realm is missing, so edits never reach an
// existing one. Idempotent. From the realm file it applies:
//   - the adili-demo execution (ALTERNATIVE, right after the SSO cookie) and its config in the
//     adili browser flow
//   - the admin-only demo_key user profile attribute
//   - each demo user's demo_key and display name
// The authenticator stays inert unless Keycloak runs with ADILI_DEMO_MODE=true.
//
//   pnpm keycloak:demo-sign-in
//   KEYCLOAK_URL=http://127.0.0.1:18080 node scripts/keycloak-demo-sign-in.mjs   # Azure VM
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REALM = 'adili';
const FLOW = 'adili browser';
const PROVIDER = 'adili-demo';
const ATTRIBUTE = 'demo_key';

const base = (process.env.KEYCLOAK_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const adminUser = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin_dev';
const realmFile = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../infra/compose/keycloak/adili-realm.json'),
    'utf8',
  ),
);

const token = await adminToken();
const admin = `${base}/admin/realms/${REALM}`;
const flowPath = `${admin}/authentication/flows/${encodeURIComponent(FLOW)}`;

await ensureProfileAttribute();
await ensureExecution();
await ensureDemoUsers();
console.log(`Demo sign-in applied to ${base} realm ${REALM}`);

async function adminToken() {
  // Keycloak may still be starting (deploy runs this right after compose up).
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: adminUser,
          password: adminPassword,
        }),
      });
      if (response.ok) return (await response.json()).access_token;
      throw new Error(`admin token: ${response.status}`);
    } catch (error) {
      if (attempt >= 36) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function call(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function ensureProfileAttribute() {
  const profile = await call('GET', `${admin}/users/profile`);
  if (profile.attributes.some((attribute) => attribute.name === ATTRIBUTE)) return;
  profile.attributes.push({
    name: ATTRIBUTE,
    displayName: 'Demo key',
    permissions: { view: ['admin'], edit: ['admin'] },
  });
  await call('PUT', `${admin}/users/profile`, profile);
  console.log(`added user profile attribute ${ATTRIBUTE}`);
}

async function ensureExecution() {
  const wanted = realmFile.authenticationFlows
    .find((flow) => flow.alias === FLOW)
    .authenticationExecutions.find((execution) => execution.authenticator === PROVIDER);
  const config = realmFile.authenticatorConfig.find(
    (each) => each.alias === wanted.authenticatorConfig,
  );

  let executions = await call('GET', `${flowPath}/executions`);
  let execution = executions.find((each) => each.providerId === PROVIDER && each.level === 0);
  if (!execution) {
    await call('POST', `${flowPath}/executions/execution`, { provider: PROVIDER });
    executions = await call('GET', `${flowPath}/executions`);
    execution = executions.find((each) => each.providerId === PROVIDER && each.level === 0);
    console.log(`added ${PROVIDER} to ${FLOW}`);
  }
  if (execution.requirement !== wanted.requirement) {
    await call('PUT', `${flowPath}/executions`, { ...execution, requirement: wanted.requirement });
  }
  // Right after the SSO cookie: a demo ticket wins over the forms, and a step-up passes too.
  for (;;) {
    const top = (await call('GET', `${flowPath}/executions`)).filter((each) => each.level === 0);
    const index = top.findIndex((each) => each.id === execution.id);
    const cookie = top.findIndex((each) => each.providerId === 'auth-cookie');
    if (index <= cookie + 1) break;
    await call('POST', `${admin}/authentication/executions/${execution.id}/raise-priority`);
  }
  if (!execution.authenticationConfig) {
    await call('POST', `${admin}/authentication/executions/${execution.id}/config`, {
      alias: config.alias,
      config: config.config,
    });
    console.log(`added config ${config.alias}`);
  }
}

async function ensureDemoUsers() {
  for (const wanted of realmFile.users ?? []) {
    const demoKey = wanted.attributes?.[ATTRIBUTE]?.[0];
    if (!demoKey) continue;
    const [user] = await call(
      'GET',
      `${admin}/users?exact=true&username=${encodeURIComponent(wanted.username)}`,
    );
    if (!user) {
      console.warn(`no user ${wanted.username}; skipped`);
      continue;
    }
    const current = user.attributes?.[ATTRIBUTE]?.[0];
    if (
      current === demoKey &&
      user.firstName === wanted.firstName &&
      user.lastName === wanted.lastName
    ) {
      continue;
    }
    // A user update replaces every attribute, so send the ones it has with demo_key added.
    await call('PUT', `${admin}/users/${user.id}`, {
      ...user,
      firstName: wanted.firstName,
      lastName: wanted.lastName,
      attributes: { ...user.attributes, [ATTRIBUTE]: [demoKey] },
    });
    console.log(`updated ${wanted.username}`);
  }
}
