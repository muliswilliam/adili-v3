#!/usr/bin/env node
// Checks that the Adili realm file still has the roles, BFF clients and
// authentication flows specs 03, 04 and 06 require. Demo users are optional
// (#371 seeds them).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const realmPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../infra/compose/keycloak/adili-realm.json',
);

const realm = JSON.parse(readFileSync(realmPath, 'utf8'));
const errors = [];

function fail(message) {
  errors.push(message);
}

if (realm.realm !== 'adili') fail('realm id must be adili');
if (realm.loginTheme !== 'adili') fail('loginTheme must be adili');
if (realm.browserFlow !== 'adili browser') fail('browserFlow must be adili browser');

const acrMap = JSON.parse(realm.attributes?.['acr.loa.map'] ?? '{}');
if (Number(acrMap['step-up']) !== 2) {
  fail('ACR mapping must include step-up -> 2 (spec 06)');
}

const roles = new Set((realm.roles?.realm ?? []).map((role) => role.name));
for (const name of [
  'declarant',
  'reporting-officer',
  'commission-admin',
  'reviewer',
  'supervisor',
  'access-officer',
  'eacc-analyst',
  'eacc-supervisor',
  'platform-admin',
  'helpdesk',
  'applicant',
  'law-enforcement',
]) {
  if (!roles.has(name)) fail(`missing realm role ${name}`);
}

const clients = new Map((realm.clients ?? []).map((client) => [client.clientId, client]));
for (const [id, port, secret] of [
  ['portal', 3010, 'portal-dev-secret'],
  ['console', 3020, 'console-dev-secret'],
  ['verify', 3030, 'verify-dev-secret'],
]) {
  const client = clients.get(id);
  if (!client) {
    fail(`missing BFF client ${id}`);
    continue;
  }
  if (client.publicClient) fail(`${id} must be a confidential BFF client`);
  if (client.directAccessGrantsEnabled) fail(`${id} must not use the password grant`);
  if (client.secret !== secret) fail(`${id} secret must be ${secret}`);
  if (!client.redirectUris?.includes(`http://localhost:${port}/*`)) {
    fail(`${id} redirect URI must include http://localhost:${port}/*`);
  }
}

for (const id of ['portal', 'console']) {
  const acr = clients.get(id)?.attributes?.['default.acr.values'];
  if (acr !== 'step-up') fail(`${id} default ACR must be step-up so login is MFA`);
}

const flows = new Map((realm.authenticationFlows ?? []).map((flow) => [flow.alias, flow]));
for (const alias of [
  'adili browser',
  'adili browser forms',
  'adili password',
  'adili otp',
  'adili declarant otp',
  'adili applicant otp',
  'adili staff totp',
]) {
  if (!flows.has(alias)) fail(`missing authentication flow ${alias}`);
}

const configs = new Map(
  (realm.authenticatorConfig ?? []).map((config) => [config.alias, config.config]),
);
const loa2 = configs.get('adili-loa-2');
if (loa2?.['loa-condition-level'] !== '2' || loa2?.['loa-max-age'] !== '300') {
  fail('adili-loa-2 must be level 2 with max age 300 (spec 06)');
}

const loa1 = configs.get('adili-loa-1');
if (loa1?.['loa-condition-level'] !== '1') {
  fail('adili-loa-1 must be level 1 so password stays in-session');
}

function hasAuthenticator(alias, authenticator) {
  return (flows.get(alias)?.authenticationExecutions ?? []).some(
    (execution) => execution.authenticator === authenticator,
  );
}

if (!hasAuthenticator('adili password', 'auth-username-password-form')) {
  fail('adili password must include the username/password form');
}
if (!hasAuthenticator('adili staff totp', 'auth-otp-form')) {
  fail('adili staff totp must include the TOTP form');
}
if (hasAuthenticator('adili declarant otp', 'adili-otp')) {
  fail('adili-otp belongs to #79; this realm only reserves the flow');
}
if (hasAuthenticator('adili applicant otp', 'adili-otp')) {
  fail('adili-otp belongs to #79; this realm only reserves the flow');
}

if (!hasAuthenticator('adili declarant otp', 'conditional-user-role')) {
  fail('adili declarant otp must be gated on the declarant role');
}
if (!hasAuthenticator('adili applicant otp', 'conditional-user-role')) {
  fail('adili applicant otp must be gated on the applicant role');
}

const actions = new Set((realm.requiredActions ?? []).map((action) => action.alias));
if (!actions.has('webauthn-register')) fail('passkeys require webauthn-register');
if (!actions.has('CONFIGURE_TOTP')) fail('staff TOTP enrolment requires CONFIGURE_TOTP');
if (!actions.has('UPDATE_PASSWORD')) fail('onboarding execute-actions needs UPDATE_PASSWORD');

if (errors.length > 0) {
  console.error(`Keycloak realm check failed (${realmPath}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Keycloak realm ok: ${realmPath}`);
