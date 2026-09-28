import { describe, expect, it } from 'vitest';

import { listRosterRecordsInput } from './roster-records';

describe('listRosterRecordsInput', () => {
  it('keeps the identity-mismatch filter for the directory', () => {
    expect(listRosterRecordsInput.parse({ slug: 'psc', identityMismatch: true })).toEqual({
      slug: 'psc',
      identityMismatch: true,
    });
  });
});
