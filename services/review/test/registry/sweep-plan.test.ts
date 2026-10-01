import { describe, expect, it } from 'vitest';

import type { RegistryCheckRequest } from '../../src/registry/contract.js';
import { planSweep, type SweepCandidate } from '../../src/registry/sweep-plan.js';

/** Spec 07b S10: the sweep is "bounded per run by the rate limits". */
const request = (n: number): RegistryCheckRequest => ({
  tenant: 'psc',
  caseId: `case-${String(n)}`,
  declarationId: `declaration-${String(n)}`,
  versionId: `version-${String(n)}`,
  version: 1,
});
const candidate = (n: number, lookups: Record<string, number>): SweepCandidate => ({
  request: request(n),
  lookups,
});

describe('planSweep', () => {
  it("starts each case once the systems it looks up have room, at the sweep's share of their rate", () => {
    const plan = planSweep(
      [candidate(1, { kra: 4 }), candidate(2, { ntsa: 2 }), candidate(3, { kra: 2, ntsa: 1 })],
      { kra: 2, ntsa: 60 },
      { share: 0.5, windowMinutes: 45 },
    );

    expect(plan).toEqual([
      { request: request(1), startAfterMs: 0 },
      // NTSA has had no lookups yet: KRA's limit does not hold it back.
      { request: request(2), startAfterMs: 0 },
      // Four KRA lookups at one a minute (half of two): four minutes in.
      { request: request(3), startAfterMs: 4 * 60_000 },
    ]);
  });

  it('ends the plan at the first case that cannot start within the window, so the oldest go first next run', () => {
    const candidates = Array.from({ length: 100 }, (_, n) => candidate(n + 1, { ardhisasa: 10 }));

    const plan = planSweep(candidates, { ardhisasa: 60 }, { share: 0.5, windowMinutes: 45 });

    // 30 lookups a minute for 45 minutes: 1350 lookups, 135 cases of ten, more than there are.
    expect(plan).toHaveLength(100);
    const tight = planSweep(candidates, { ardhisasa: 2 }, { share: 0.5, windowMinutes: 45 });
    // One lookup a minute: a case of ten every ten minutes, five within 45 minutes.
    expect(tight.map((entry) => entry.request.caseId)).toEqual([
      'case-1',
      'case-2',
      'case-3',
      'case-4',
      'case-5',
    ]);
    expect(tight.at(-1)?.startAfterMs).toBe(40 * 60_000);
  });

  it('a raised rate limit takes more cases a run', () => {
    const candidates = Array.from({ length: 50 }, (_, n) => candidate(n + 1, { kra: 4 }));

    expect(planSweep(candidates, { kra: 4 })).toHaveLength(23);
    expect(planSweep(candidates, { kra: 30 })).toHaveLength(50);
  });

  it('a system without a known limit holds no case back', () => {
    expect(planSweep([candidate(1, { kra: 9 }), candidate(2, { kra: 9 })], {})).toEqual([
      { request: request(1), startAfterMs: 0 },
      { request: request(2), startAfterMs: 0 },
    ]);
  });
});
