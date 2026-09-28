import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { DeclarationIssue } from '../declaration.js';
import type { DeclarationV1 } from '../declaration.v1.gen.js';
import type { FormMIssue } from '../form-m.js';
import type { FormMV1 } from '../form-m.v1.gen.js';
import type { FormValidationError } from '../validate.js';

const require = createRequire(import.meta.url);
const schemasDir = dirname(require.resolve('@adili/schemas/package.json'));

/** A failing fixture: what ajv reports, and where the form's helper places it. */
export interface InvalidFixture<Document, Issue> {
  description: string;
  errors: string[];
  issues: Issue[];
  document: Document;
}

function read<T>(form: string, kind: 'valid' | 'invalid'): (readonly [string, T])[] {
  const dir = join(schemasDir, 'forms/fixtures', form, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as T] as const);
}

export type InvalidDeclarationFixture = InvalidFixture<DeclarationV1, DeclarationIssue>;
export const validDeclarations = () => read<DeclarationV1>('declaration.v1', 'valid');
export const invalidDeclarations = () =>
  read<InvalidDeclarationFixture>('declaration.v1', 'invalid');

export const validFormMs = () => read<FormMV1>('form-m.v1', 'valid');
export const invalidFormMs = () =>
  read<InvalidFixture<FormMV1, FormMIssue>>('form-m.v1', 'invalid');

/** A fresh copy of the complete biennial with two spouses and three children. */
export function biennialHousehold(): DeclarationV1 {
  const found = validDeclarations().find(([name]) => name === 'biennial-household.json');
  if (!found) throw new Error('valid/biennial-household.json is missing');
  return found[1];
}

/** A fresh copy of the complete, submitted FY 2027 Form M. */
export function completeFormM(): FormMV1 {
  const found = validFormMs().find(([name]) => name === 'complete-fy-2027.json');
  if (!found) throw new Error('valid/complete-fy-2027.json is missing');
  return found[1];
}

/** The path of a declaration-level problem, for assertions. */
export const pathsOf = (errors: FormValidationError[]) => errors.map((error) => error.path);

/** The declarations service's internal contract, as committed. */
export function declarationsContract(): string {
  return readFileSync(join(schemasDir, 'internal/declarations.yaml'), 'utf8');
}
