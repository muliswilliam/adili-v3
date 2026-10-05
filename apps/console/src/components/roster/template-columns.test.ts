import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EVERY_CONTRACT_COLUMN_LISTED,
  REQUIRED_COLUMNS,
  TEMPLATE_COLUMNS,
} from './template-columns';

// The generated types are a union, with no runtime list or order, so read the list from the contract.
const contract = readFileSync(
  new URL('../../../node_modules/@adili/schemas/internal/directory.yaml', import.meta.url),
  'utf8',
);

/** The template columns `ColumnMapping.matched[].field` enumerates, in contract order. */
function contractColumns(): string[] {
  const field = /ColumnMapping:[\s\S]*?field:\s+type: string\s+enum:\n((?:\s+- \w+\n)+)/.exec(
    contract,
  );
  return [...(field?.[1] ?? '').matchAll(/- (\w+)/g)].map((match) => match[1] ?? '');
}

describe('TEMPLATE_COLUMNS', () => {
  it('lists the directory contract columns, in its order', () => {
    // The type of this constant fails the typecheck when the contract gains a column.
    expect(EVERY_CONTRACT_COLUMN_LISTED).toBe(true);
    const columns = contractColumns();
    expect(columns).toContain('personnel_file_number');
    expect(TEMPLATE_COLUMNS.map((column) => column.name)).toEqual(columns);
  });

  it('requires the personnel file number, full name and national ID', () => {
    expect(REQUIRED_COLUMNS).toEqual(['personnel_file_number', 'full_name', 'national_id']);
  });

  it('gives every column a format rule and an example', () => {
    for (const column of TEMPLATE_COLUMNS) {
      expect(column.format).not.toBe('');
      expect(column.example).not.toBe('');
    }
  });
});
