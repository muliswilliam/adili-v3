import { beforeEach, describe, expect, it } from 'vitest';

import { loadPatternCandidates } from './pattern-candidates.server';
import { resetCandidatesMock } from './reporting/candidates-mock.server';
import { mockReportingClient } from './reporting/mock.server';
import { resetNcrMock } from './reporting/ncr-mock.server';

const as = (roles: readonly string[]) =>
  mockReportingClient(roles, { name: 'Baraka Mutua', subject: 'user-baraka', tenant: 'eacc' });

beforeEach(() => {
  resetNcrMock('draft');
  resetCandidatesMock('computed');
});

describe('S1 loadPatternCandidates', () => {
  it("lists FY 2025/2026's candidates by kind, the largest first", async () => {
    const result = await loadPatternCandidates(as(['eacc-analyst']), 2025);

    if (!result.ok) throw new Error('expected candidates');
    expect(result.data.map(({ kind, subject }) => `${kind} ${subject}`)).toEqual([
      'rate-change cpsbnairobicity',
      'threshold-breach cpsbnairobicity',
      'chronic-late-reporting tsc',
      'clarification-ratio-outlier psc',
      'clarification-ratio-outlier cpsbnairobicity',
      'clarification-ratio-outlier parlsc',
      'size-band-outlier cpsbnairobicity',
      'non-reporting cpsbmandera',
      'non-reporting cpsbkwale',
      'non-reporting cpsbturkana',
    ]);
  });

  it('carries the figures and the keys they are cited by', async () => {
    const result = await loadPatternCandidates(as(['eacc-supervisor']), 2025);

    if (!result.ok) throw new Error('expected candidates');
    expect(result.data[0]).toEqual({
      id: 'rate-change:cpsbnairobicity:nonFilerRate',
      kind: 'rate-change',
      subject: 'cpsbnairobicity',
      // 6,368 of 18,490 officers did not declare, from 15.2% the year before.
      values: { from: 0.152, to: 0.3444, change: 0.1924, factor: 2.27 },
      aggregateKeys: [
        'fy2025.commission.cpsbnairobicity.nonFilerRate',
        'commission.cpsbnairobicity.nonFilerRate',
      ],
    });
    expect(result.data.find((each) => each.kind === 'chronic-late-reporting')).toMatchObject({
      values: { years: 3 },
      aggregateKeys: [
        'commission.tsc.reportedLate',
        'fy2025.commission.tsc.reportedLate',
        'fy2024.commission.tsc.reportedLate',
      ],
    });
  });

  it('has none when nothing crossed the thresholds', async () => {
    resetCandidatesMock('none');

    expect(await loadPatternCandidates(as(['eacc-analyst']), 2025)).toEqual({ ok: true, data: [] });
  });

  it('is 404 before the year is built', async () => {
    resetNcrMock('not-built');

    expect(await loadPatternCandidates(as(['eacc-analyst']), 2025)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
  });

  it('is 403 to anyone outside EACC', async () => {
    expect(await loadPatternCandidates(as(['supervisor']), 2025)).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
  });

  it('fails as the service would when it cannot answer', async () => {
    resetCandidatesMock('error');

    expect(await loadPatternCandidates(as(['eacc-analyst']), 2025)).toMatchObject({ ok: false });
  });
});
