import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { FormMV1 } from '@adili/forms';

import type { Caller } from './reporting-api.js';

/** The OAuth scope of a federated Commission's system (spec 09 federated submission). */
export const REPORTS_SUBMIT = 'reports:submit';

/** The demo federated Commission's system: a client-credentials token for `tsc`. */
export const TSC_SYSTEM: Caller = {
  sub: 'service-account-tsc-reports',
  tenant: 'tsc',
  scopes: [REPORTS_SUBMIT],
  name: 'service-account-tsc-reports',
};

const require = createRequire(import.meta.url);

/** A valid `form-m.v1` fixture of packages/schemas, by its name under `fixtures/form-m.v1/valid/`. */
export function validFormM(name: string): FormMV1 {
  return fixture(`valid/${name}`) as FormMV1;
}

/** An invalid `form-m.v1` fixture: the document and the paths of its schema problems. */
export function invalidFormM(name: string): { errors: string[]; document: FormMV1 } {
  return fixture(`invalid/${name}`) as { errors: string[]; document: FormMV1 };
}

function fixture(name: string): unknown {
  const path = require.resolve(`@adili/schemas/forms/fixtures/form-m.v1/${name}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The complete FY 2027 fixture as the Teachers Service Commission's system files it: Part I names
 * `tsc` (issuer `TSC`), and no platform `meta` (the platform fills it).
 */
export function tscFormM(): FormMV1 {
  return asTsc(validFormM('complete-fy-2027.json'));
}

/** `document` with Part I naming the Teachers Service Commission and no platform `meta`. */
export function asTsc(document: FormMV1): FormMV1 {
  const tsc = withoutMeta(document);
  tsc.partI = { ...tsc.partI, commissionName: 'Teachers Service Commission', issuerCode: 'TSC' };
  return tsc;
}

/** A copy of `document` without the platform's `meta`, as a Commission's own system files it. */
export function withoutMeta(document: FormMV1): FormMV1 {
  const copy = structuredClone(document);
  delete copy.meta;
  return copy;
}
