import { describe, expect, it } from 'vitest';

import { isFlagged, recordImport } from './record-imports';

const imports = [
  { importId: 'b', startedAt: '2026-09-21T09:00:00Z', outcome: 'updated' as const },
  { importId: 'a', startedAt: '2026-08-01T09:00:00Z', outcome: 'created' as const },
];

describe('recordImport', () => {
  it('finds the import among those that touched the record', () => {
    expect(recordImport({ imports }, 'a')).toEqual(imports[1]);
  });

  it('is null when the record names no import', () => {
    expect(recordImport({ imports }, null)).toBeNull();
  });

  it('is null when the history does not hold the import', () => {
    expect(recordImport({ imports }, 'c')).toBeNull();
  });
});

describe('isFlagged', () => {
  it('flags a record absent from the latest complete import', () => {
    expect(isFlagged({ absentFromLatestImport: true, state: 'not_onboarded' })).toBe(true);
  });

  it('never flags an exited officer', () => {
    expect(isFlagged({ absentFromLatestImport: true, state: 'exited' })).toBe(false);
  });

  it('does not flag a record seen in the latest import', () => {
    expect(isFlagged({ absentFromLatestImport: false, state: 'onboarded' })).toBe(false);
  });
});
