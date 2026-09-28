import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { DeclarationIssue } from '../declaration.js';
import type { DeclarationV1 } from '../declaration.v1.gen.js';
import type { FormValidationError } from '../validate.js';

const require = createRequire(import.meta.url);
const schemasDir = dirname(require.resolve('@adili/schemas/package.json'));
const fixturesDir = join(schemasDir, 'forms/fixtures/declaration.v1');

/** A paragraph's failing fixture: what ajv reports, and where declarationIssues places it. */
export interface InvalidDeclarationFixture {
  description: string;
  errors: string[];
  issues: DeclarationIssue[];
  document: DeclarationV1;
}

function read<T>(kind: 'valid' | 'invalid'): (readonly [string, T])[] {
  const dir = join(fixturesDir, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as T] as const);
}

export const validDeclarations = () => read<DeclarationV1>('valid');
export const invalidDeclarations = () => read<InvalidDeclarationFixture>('invalid');

/** A fresh copy of the complete biennial with two spouses and three children. */
export function biennialHousehold(): DeclarationV1 {
  const found = validDeclarations().find(([name]) => name === 'biennial-household.json');
  if (!found) throw new Error('valid/biennial-household.json is missing');
  return found[1];
}

/** The path of a declaration-level problem, for assertions. */
export const pathsOf = (errors: FormValidationError[]) => errors.map((error) => error.path);

/** The declarations service's internal contract, as committed. */
export function declarationsContract(): string {
  return readFileSync(join(schemasDir, 'internal/declarations.yaml'), 'utf8');
}
