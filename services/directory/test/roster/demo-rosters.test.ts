import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseRosterFile } from '../../src/roster/roster-file.js';

/**
 * The demo roster files the HR mock generates (mocks/demo/rosters, `pnpm --filter @adili/mocks
 * roster:files`) import as the demo expects: every HR row accepted, and each planted bad row
 * rejected for its one reason.
 */
const DEMO_FILES = new URL('../../../../mocks/demo/rosters/', import.meta.url);

const EXPECTED = {
  psc: {
    accepted: 5,
    rejected: [
      { rowNumber: 3, field: 'nationalId', code: 'format' },
      { rowNumber: 5, field: 'personnelFileNumber', code: 'duplicate-in-file' },
      { rowNumber: 7, field: 'appointmentDate', code: 'future-date' },
      { rowNumber: 9, field: 'email', code: 'format' },
      { rowNumber: 11, field: 'phone', code: 'format' },
      { rowNumber: 12, field: 'fullName', code: 'required' },
    ],
  },
  tsc: {
    accepted: 8,
    rejected: [
      { rowNumber: 3, field: 'personnelFileNumber', code: 'too-long' },
      { rowNumber: 5, field: 'nationalId', code: 'duplicate-in-file' },
      { rowNumber: 7, field: 'appointmentDate', code: 'format' },
      { rowNumber: 9, field: 'nationalId', code: 'format' },
      { rowNumber: 11, field: 'jobGroup', code: 'too-long' },
      { rowNumber: 13, field: 'email', code: 'format' },
    ],
  },
};

describe('demo roster files', () => {
  it.each(Object.entries(EXPECTED))(
    '%s: accepts the HR rows and rejects each planted row',
    async (commission, expected) => {
      const bytes = readFileSync(new URL(`${commission}-roster.csv`, DEMO_FILES));

      const file = await parseRosterFile(bytes, 'csv');

      if (!file.ok) throw new Error(`missing ${file.missingRequired.join(', ')}`);
      expect(file.mapping).toMatchObject({ ignored: [], missing: [] });
      const rejected = [];
      let accepted = 0;
      for await (const row of file.rows) {
        if (row.status === 'accepted') accepted += 1;
        else rejected.push({ rowNumber: row.rowNumber, errors: row.errors });
      }
      expect(accepted).toBe(expected.accepted);
      expect(
        rejected.map(({ rowNumber, errors }) => ({
          rowNumber,
          errors: errors.map(({ field, code }) => ({ field, code })),
        })),
      ).toEqual(
        expected.rejected.map(({ rowNumber, field, code }) => ({
          rowNumber,
          errors: [{ field, code }],
        })),
      );
    },
  );
});
