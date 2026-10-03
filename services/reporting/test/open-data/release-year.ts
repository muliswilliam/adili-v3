import { randomUUID } from 'node:crypto';

import { v7 as uuidv7 } from 'uuid';

import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import {
  actionFacts,
  clarificationFacts,
  complianceReports,
  determinationFacts,
  referralFacts,
  reportReceipts,
} from '../../src/db/schema.js';
import type { ComplianceCounts } from '../../src/open-data/tables.js';
import type { ReportingApi } from '../support/reporting-api.js';
import { RELEASE_COMPLIANCE, RELEASE_COUNTS, RELEASE_FY } from './release-fixtures.js';

/** Arranges the release fixtures (release-fixtures.ts) in the reporting database. */

/** The Commission's FY 2027 report as submitted, and EACC's receipt of it. */
export async function givenReportSubmitted(
  api: ReportingApi,
  tenant: string,
  counts: ReportCounts,
): Promise<void> {
  const reportId = uuidv7();
  const late = tenant === 'tsc';
  const values = {
    tenant,
    fy: RELEASE_FY,
    source: 'hosted' as const,
    reference: `RPT-${tenant.toUpperCase()}-2028-0000001-X`,
    submittedAt: new Date(late ? '2028-08-05T07:00:00.000Z' : '2028-07-20T07:00:00.000Z'),
    late,
    counts,
  };
  await api.asPlatform(async (tx) => {
    await tx.insert(complianceReports).values({ id: reportId, status: 'submitted', ...values });
    await tx.insert(reportReceipts).values({ reportId, ...values });
  });
}

/** The Commission's facts for the year, plus some the release must not count. */
async function givenFacts(
  api: ReportingApi,
  tenant: string,
  counts: ComplianceCounts,
): Promise<void> {
  const inYear = new Date('2027-11-15T09:00:00.000Z');
  await api.asPlatform(async (tx) => {
    for (const [outcome, n] of Object.entries(counts.determinations)) {
      for (let i = 0; i < n; i += 1) {
        await tx.insert(determinationFacts).values({
          determinationId: randomUUID(),
          tenant,
          caseId: randomUUID(),
          outcome,
          fy: RELEASE_FY,
          approvedAt: inYear,
        });
      }
    }
    for (let i = 0; i < counts.clarificationsResolved; i += 1) {
      await tx.insert(clarificationFacts).values({
        clarificationId: randomUUID(),
        tenant,
        caseId: randomUUID(),
        fy: RELEASE_FY,
        issuedAt: inYear,
        status: 'resolved',
        statusAt: inYear,
        resolvedAt: inYear,
      });
    }
    for (const [step, n] of Object.entries(counts.actions)) {
      for (let i = 0; i < n; i += 1) {
        await tx.insert(actionFacts).values({
          actionId: randomUUID(),
          tenant,
          subjectKind: 'obligation',
          subjectId: randomUUID(),
          step: step as 'warning',
          status: i % 2 === 0 ? 'issued' : 'complied',
          statusAt: inYear,
          issuedAt: inYear,
        });
      }
    }
    for (let i = 0; i < counts.referrals; i += 1) {
      await tx.insert(referralFacts).values({
        referralId: randomUUID(),
        tenant,
        reference: `REF-${tenant.toUpperCase()}-${String(i)}`,
        grounds: 'undeclared-assets',
        fy: RELEASE_FY,
        sentAt: inYear,
      });
    }
    // Not the year's, or not counted: another year's determination, an outcome the tables do
    // not know, a clarification still open, an action proposed and one issued next year.
    const nextYear = new Date('2028-07-02T09:00:00.000Z');
    await tx.insert(determinationFacts).values([
      {
        determinationId: randomUUID(),
        tenant,
        caseId: randomUUID(),
        outcome: 'compliant',
        fy: RELEASE_FY - 1,
        approvedAt: new Date('2027-01-10T09:00:00.000Z'),
      },
      {
        determinationId: randomUUID(),
        tenant,
        caseId: randomUUID(),
        outcome: 'withdrawn',
        fy: RELEASE_FY,
        approvedAt: inYear,
      },
    ]);
    await tx.insert(clarificationFacts).values({
      clarificationId: randomUUID(),
      tenant,
      caseId: randomUUID(),
      fy: RELEASE_FY,
      issuedAt: inYear,
      status: 'issued',
      statusAt: inYear,
    });
    await tx.insert(actionFacts).values([
      {
        actionId: randomUUID(),
        tenant,
        subjectKind: 'obligation',
        subjectId: randomUUID(),
        step: 'warning',
        status: 'proposed',
        statusAt: inYear,
      },
      {
        actionId: randomUUID(),
        tenant,
        subjectKind: 'obligation',
        subjectId: randomUUID(),
        step: 'warning',
        status: 'issued',
        statusAt: nextYear,
        issuedAt: nextYear,
      },
    ]);
  });
}

/** FY 2027 as the fixtures have it: the reports submitted and the projection facts. */
export async function givenReleaseYear(api: ReportingApi): Promise<void> {
  for (const [tenant, counts] of Object.entries(RELEASE_COUNTS)) {
    await givenReportSubmitted(api, tenant, counts);
  }
  for (const [tenant, counts] of Object.entries(RELEASE_COMPLIANCE)) {
    await givenFacts(api, tenant, counts);
  }
}
