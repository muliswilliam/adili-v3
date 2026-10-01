#!/usr/bin/env node
// Checks that the Adili realm file still has the roles, BFF clients, authentication flows (with
// the adili-otp authenticator), staff provisioning setup (directory service client, SMTP, email
// theme, user profile attributes), declarant accounts (multi-valued tenants), service clients and
// scopes (messages, iprs, directory:internal, directory:person-contacts,
// directory:roster-national-id and directory:applicants; the keycloak-extension, declarations and notifications clients) and API client setup (roster:write client scope; documents:internal and
// the adili-api audience for the directory) specs 03, 04, 06, 10 and 27 require. Demo users are optional (#371 seeds them). Portal and console tokens carry the
// person_id claim (spec 04). Applicant accounts carry the identityStatus attribute (spec 10).
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
  // Declarant data is keyed by person (spec 04): the person_id attribute becomes a token claim.
  const personId = (clients.get(id)?.protocolMappers ?? []).find(
    (mapper) =>
      mapper.protocolMapper === 'oidc-usermodel-attribute-mapper' &&
      mapper.config?.['user.attribute'] === 'person_id',
  );
  if (personId?.config?.['claim.name'] !== 'person_id') {
    fail(`${id} needs a person_id user attribute mapper to the person_id claim (spec 04)`);
  } else if (personId.config['access.token.claim'] !== 'true') {
    fail(`${id}: the person_id claim must be on the access token`);
  }
}
// Law-enforcement officers (spec 10) sign in to the console; their agency is a token claim.
const agency = (clients.get('console')?.protocolMappers ?? []).find(
  (mapper) =>
    mapper.protocolMapper === 'oidc-usermodel-attribute-mapper' &&
    mapper.config?.['user.attribute'] === 'agency',
);
if (agency?.config?.['claim.name'] !== 'agency' || agency.config['access.token.claim'] !== 'true') {
  fail('console needs an agency user attribute mapper to the agency access token claim (spec 10)');
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
if (loa2?.['loa-condition-level'] !== '2' || loa2?.['loa-max-age'] !== '180') {
  // 300 s window services accept less a 120 s margin (@adili/bff-auth STEP_UP_CODE_MAX_AGE_SECONDS).
  fail('adili-loa-2 must be level 2 with max age 180 (spec 06 step-up window less margin)');
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
// Declarants and applicants get the Adili OTP authenticator (#79); staff keep TOTP.
for (const alias of ['adili declarant otp', 'adili applicant otp']) {
  const otp = (flows.get(alias)?.authenticationExecutions ?? []).find(
    (execution) => execution.authenticator === 'adili-otp',
  );
  if (otp?.requirement !== 'REQUIRED') fail(`${alias} must require the adili-otp authenticator`);
  else if (!configs.has(otp.authenticatorConfig)) {
    fail(`${alias}: adili-otp must name an authenticator config`);
  }
}
if (hasAuthenticator('adili staff totp', 'adili-otp')) {
  fail('adili staff totp must not use adili-otp; staff keep TOTP');
}
const otpConfig = configs.get('adili-otp');
if (otpConfig && !otpConfig.clientSecret?.startsWith('${vault.')) {
  fail('adili-otp clientSecret must be a vault expression, not a literal');
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
if (!actions.has('VERIFY_EMAIL')) fail('onboarding execute-actions needs VERIFY_EMAIL');

// Staff provisioning (spec 06): the directory creates accounts and sends the activation email.
if (realm.emailTheme !== 'adili') fail('emailTheme must be adili (activation email)');
if (!realm.smtpServer?.host) fail('smtpServer is required for execute-actions emails');

const extension = clients.get('keycloak-extension');
if (!extension) {
  fail('missing keycloak-extension client (adili-otp sends codes with it)');
} else {
  if (extension.publicClient || !extension.serviceAccountsEnabled) {
    fail('keycloak-extension must be a confidential client with a service account');
  }
  if (extension.standardFlowEnabled || extension.directAccessGrantsEnabled) {
    fail('keycloak-extension must not sign users in');
  }
  if (!extension.defaultClientScopes?.includes('messages')) {
    fail('keycloak-extension needs the messages scope');
  }
}

const directory = clients.get('directory');
if (!directory) {
  fail('missing directory service client');
} else {
  if (directory.publicClient) fail('directory must be a confidential client');
  if (!directory.serviceAccountsEnabled) fail('directory must use a service account');
  if (directory.standardFlowEnabled || directory.directAccessGrantsEnabled) {
    fail('directory must not sign users in');
  }
  const account = (realm.users ?? []).find((user) => user.serviceAccountClientId === 'directory');
  const granted = new Set(account?.clientRoles?.['realm-management'] ?? []);
  // Users for staff provisioning (spec 06), clients for HR-system credentials (spec 27).
  for (const role of [
    'manage-users',
    'view-users',
    'query-users',
    'manage-clients',
    'view-clients',
    'query-clients',
  ]) {
    if (!granted.has(role)) fail(`directory service account needs realm-management ${role}`);
  }
}

// Client scopes. A realm file that lists clientScopes gets none of Keycloak's
// built-in ones, so every scope a client (or the realm default) names must be
// listed here too.
const scopes = new Map((realm.clientScopes ?? []).map((scope) => [scope.name, scope]));

// Service scopes: each puts the adili-api audience on the token and names the API it opens
// (reports:submit: federated Commissions' Form M, spec 09).
for (const name of [
  'messages',
  'iprs',
  'directory:internal',
  'directory:person-contacts',
  'declarations:internal',
  'directory:roster-national-id',
  'directory:applicants',
  'reports:submit',
]) {
  const scope = scopes.get(name);
  if (!scope) {
    fail(`missing client scope ${name}`);
    continue;
  }
  const audience = (scope.protocolMappers ?? []).some(
    (mapper) =>
      mapper.protocolMapper === 'oidc-audience-mapper' &&
      mapper.config?.['included.custom.audience'] === 'adili-api',
  );
  if (!audience) fail(`client scope ${name} must add the adili-api audience`);
}

const rosterWrite = scopes.get('roster:write');
if (!rosterWrite) {
  fail('missing client scope roster:write (HR-system API clients, spec 27)');
} else {
  if (rosterWrite.protocol !== 'openid-connect') fail('roster:write must be an OIDC scope');
  if (rosterWrite.attributes?.['include.in.token.scope'] !== 'true') {
    fail('roster:write must be included in the token scope claim');
  }
}
// The directory's own token calls the documents internal API (spec 27 decision 2): it
// needs the documents:internal scope by default and the adili-api audience services verify.
const documentsInternal = scopes.get('documents:internal');
if (!documentsInternal) {
  fail('missing client scope documents:internal (service-to-service, spec 27)');
} else if (documentsInternal.attributes?.['include.in.token.scope'] !== 'true') {
  fail('documents:internal must be included in the token scope claim');
}
if (directory) {
  if (!directory.defaultClientScopes?.includes('documents:internal')) {
    fail('directory must get client scope documents:internal by default');
  }
  const audience = (directory.protocolMappers ?? []).some(
    (mapper) =>
      mapper.protocolMapper === 'oidc-audience-mapper' &&
      mapper.config?.['included.custom.audience'] === 'adili-api' &&
      mapper.config?.['access.token.claim'] === 'true',
  );
  if (!audience) fail('directory tokens need the adili-api audience mapper');
}
// Services pull from the directory's internal API (spec 04): declarations (roster records and
// policy after roster events, reminders through notifications, and declaration attachments in
// documents, spec 05) and notifications (a person's verified contacts).
// The documents service pulls a submitted version's acknowledgement slip payload from
// declarations (spec 06).
for (const [id, needed] of [
  ['declarations', ['directory:internal', 'messages', 'documents:internal']],
  ['notifications', ['directory:person-contacts']],
  ['documents', ['declarations:internal']],
]) {
  const client = clients.get(id);
  if (!client) {
    fail(`missing ${id} service client`);
    continue;
  }
  if (client.publicClient || !client.serviceAccountsEnabled) {
    fail(`${id} must be a confidential client with a service account`);
  }
  if (client.standardFlowEnabled || client.directAccessGrantsEnabled) {
    fail(`${id} must not sign users in`);
  }
  for (const scope of needed) {
    if (!client.defaultClientScopes?.includes(scope)) fail(`${id} needs the ${scope} scope`);
  }
}
// A person's contacts are personal data: only notifications may read them (spec 04).
for (const client of realm.clients ?? []) {
  const scopesOf = [...(client.defaultClientScopes ?? []), ...(client.optionalClientScopes ?? [])];
  if (client.clientId !== 'notifications' && scopesOf.includes('directory:person-contacts')) {
    fail(`${client.clientId} must not get directory:person-contacts (notifications only)`);
  }
  // A national ID likewise: only review reads it, for payroll and the ICMS referral (spec 08).
  if (client.clientId !== 'review' && scopesOf.includes('directory:roster-national-id')) {
    fail(`${client.clientId} must not get directory:roster-national-id (review only)`);
  }
  // Applicants' particulars likewise: only access reads them and records verifications (spec 10).
  if (client.clientId !== 'access' && scopesOf.includes('directory:applicants')) {
    fail(`${client.clientId} must not get directory:applicants (access only)`);
  }
}
// API clients the directory creates get `basic` (the `sub` claim) with their own scope.
if (!scopes.has('basic')) fail('missing client scope basic (API client tokens need sub)');
const referenced = [
  ...(realm.defaultDefaultClientScopes ?? []).map((name) => ['realm default', name]),
  ...(realm.defaultOptionalClientScopes ?? []).map((name) => ['realm optional', name]),
  ...(realm.clients ?? []).flatMap((client) =>
    [...(client.defaultClientScopes ?? []), ...(client.optionalClientScopes ?? [])].map((name) => [
      client.clientId,
      name,
    ]),
  ),
];
if (realm.clientScopes) {
  for (const [owner, name] of referenced) {
    if (!scopes.has(name))
      fail(`${owner} names client scope ${name}, which is not in clientScopes`);
  }
}

const profileProvider = realm.components?.['org.keycloak.userprofile.UserProfileProvider']?.[0];
const profile = JSON.parse(profileProvider?.config?.['kc.user.profile.config']?.[0] ?? '{}');
const attributes = new Map(
  (profile.attributes ?? []).map((attribute) => [attribute.name, attribute]),
);
// Staff provisioning (spec 01), declarant accounts (spec 03), and law-enforcement and applicant
// accounts (spec 10). person_id is an access claim (spec 04): a user who could edit it could read
// another person's data; so is agency, which names the agency an officer requests for.
// identityStatus is an access officer's verification of a passport applicant.
for (const name of [
  'tenant',
  'phone',
  'commissionName',
  'invitedRole',
  'tenants',
  'ofr',
  'person_id',
  'agency',
  'identityStatus',
]) {
  const attribute = attributes.get(name);
  if (!attribute) {
    fail(`user profile must declare ${name} (unmanaged attributes are read-only)`);
  } else if (attribute.permissions?.edit?.join() !== 'admin') {
    fail(`user profile attribute ${name} must be editable by admins only`);
  }
}
// A declarant onboarded with several Commissions has one `tenants` value each (spec 03).
if (attributes.get('tenants') && attributes.get('tenants').multivalued !== true) {
  fail('user profile attribute tenants must be multivalued');
}

if (errors.length > 0) {
  console.error(`Keycloak realm check failed (${realmPath}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Keycloak realm ok: ${realmPath}`);
