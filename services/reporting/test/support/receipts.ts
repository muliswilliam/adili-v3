import type { ReceiptFacts } from '../../src/compliance-reports/intake.js';
import type { ReportCounts } from '../../src/compliance-reports/schema.js';

/** A section's counts: `declared` of `expected`, the rest not declared. */
export function section(
  expected: number,
  declared: number,
): { expected: number; declared: number; notDeclared: number } {
  return { expected, declared, notDeclared: expected - declared };
}

/** A submitted report's counts: every section filed, `overrides` replacing whole entries. */
export function reportCounts(overrides: Partial<ReportCounts> = {}): ReportCounts {
  return {
    initial: section(12, 10),
    biennial: { ...section(100, 95), noCycleInPeriod: false },
    final: section(4, 4),
    clarifications: 6,
    accessRequests: { received: 0, granted: 0, declined: 0 },
    ...overrides,
  };
}

/**
 * EACC's receipt of the Commission's FY 2027 report: on 20 July 2028, or on 5 August when
 * `late`.
 */
export function receiptOf(
  tenant: string,
  options: { late?: boolean; counts?: ReportCounts } = {},
): ReceiptFacts {
  const late = options.late ?? false;
  return {
    reportId: `0199b000-0000-7000-8000-00000000000${String(tenant.length)}`,
    tenant,
    reference: `RPT-${tenant.toUpperCase()}-2027-0000001-4`,
    submittedAt: new Date(late ? '2028-08-05T07:00:00.000Z' : '2028-07-20T07:00:00.000Z'),
    late,
    counts: options.counts ?? reportCounts(),
    formMDocumentId: null,
    receiptDocumentId: null,
  };
}
