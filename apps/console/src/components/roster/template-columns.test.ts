import { describe, expect, it } from 'vitest';

// The directory's column definitions are the single source; the console mirrors them.
import { ROSTER_COLUMNS } from '../../../../../services/directory/src/roster/columns';
import { REQUIRED_COLUMNS, TEMPLATE_COLUMNS } from './template-columns';

describe('TEMPLATE_COLUMNS', () => {
  it('lists the directory template columns in order, with their rules and examples', () => {
    expect(TEMPLATE_COLUMNS).toEqual(
      ROSTER_COLUMNS.map(({ name, required, format, example }) => ({
        name,
        required,
        format,
        example,
      })),
    );
  });

  it('has nine columns, three of them required', () => {
    expect(TEMPLATE_COLUMNS).toHaveLength(9);
    expect(REQUIRED_COLUMNS).toEqual(['personnel_file_number', 'full_name', 'national_id']);
  });
});
