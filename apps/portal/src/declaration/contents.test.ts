import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ASSET_TYPES,
  ATTESTATION_TEXT,
  CHANGE_KINDS,
  EMPLOYMENT_NATURES,
  INCOME_TYPES,
  LIABILITY_TYPES,
  MARITAL_STATUSES,
  MEMBERSHIP_KINDS,
  OCCUPATION_SECTORS,
} from './contents';

interface Node {
  enum?: string[];
  const?: string;
  properties?: Record<string, Node>;
  items?: Node;
  $defs?: Record<string, Node>;
}

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../node_modules/@adili/schemas/forms/declaration.v1.json', import.meta.url),
    ),
    'utf8',
  ),
) as Node;

function at(node: Node | undefined, ...path: string[]): Node {
  let current = node;
  for (const key of path) {
    current = key === 'items' ? current?.items : current?.properties?.[key];
  }
  if (!current) throw new Error(`${path.join('.')} is not in declaration.v1`);
  return current;
}

const defs = schema.$defs ?? {};

// The types come from the generated form.gen.ts; these keep the option lists in the form's order.
describe('declaration.v1 enums', () => {
  it.each([
    ['marital status', at(schema, 'officer', 'maritalStatus').enum, MARITAL_STATUSES],
    [
      'nature of employment',
      at(schema, 'officer', 'employment', 'nature').enum,
      EMPLOYMENT_NATURES,
    ],
    ['occupation sector', at(defs.Spouse, 'occupationSector').enum, OCCUPATION_SECTORS],
    ['income type', at(defs.IncomeItem, 'type').enum, INCOME_TYPES],
    ['asset type', at(defs.AssetItem, 'type').enum, ASSET_TYPES],
    ['liability type', at(defs.LiabilityItem, 'type').enum, LIABILITY_TYPES],
    ['change kind', at(defs.ChangeFlag, 'kind').enum, CHANGE_KINDS],
    [
      'membership kind',
      at(defs.RegistrableInterests, 'memberships', 'items', 'kind').enum,
      MEMBERSHIP_KINDS,
    ],
  ])('%s matches the schema', (_name, fromSchema, handWritten) => {
    expect(fromSchema).toEqual([...handWritten]);
  });

  it('keeps the solemn declaration text', () => {
    expect(at(schema, 'attestation', 'text').const).toBe(ATTESTATION_TEXT);
  });
});
