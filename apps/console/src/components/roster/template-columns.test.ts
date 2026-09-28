import { describe, expect, it } from 'vitest';

import {
  EVERY_CONTRACT_COLUMN_LISTED,
  REQUIRED_COLUMNS,
  TEMPLATE_COLUMNS,
} from './template-columns';

describe('TEMPLATE_COLUMNS', () => {
  it('lists every column of the directory contract once', () => {
    // The type of this constant fails the typecheck when the contract gains a column.
    expect(EVERY_CONTRACT_COLUMN_LISTED).toBe(true);
    const names = TEMPLATE_COLUMNS.map((column) => column.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has nine columns, three of them required', () => {
    expect(TEMPLATE_COLUMNS).toHaveLength(9);
    expect(REQUIRED_COLUMNS).toEqual(['personnel_file_number', 'full_name', 'national_id']);
  });

  it('gives every column a format rule and an example', () => {
    for (const column of TEMPLATE_COLUMNS) {
      expect(column.format).not.toBe('');
      expect(column.example).not.toBe('');
    }
  });
});
