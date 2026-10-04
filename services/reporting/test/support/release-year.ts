import { randomUUID } from 'node:crypto';

import { ACCESS_GROUNDS } from '@adili/events/contracts';
import { v7 as uuidv7 } from 'uuid';

import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import {
  accessRequestFacts,
  actionFacts,
  clarificationFacts,
  complianceReports,
  determinationFacts,
  obligationFacts,
  referralFacts,
  reportReceipts,
} from '../../src/db/schema.js';
import type { ComplianceCounts } from '../../src/open-data/tables.js';
import type { ReportingApi } from './reporting-api.js';
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

/**
 * FY 2027 in progress, as the live projections hold it (no report submitted yet): each
 * Commission's filing obligations, clarifications and Form K requests as its Form M would compile
 * to the counts it reports (`RELEASE_COUNTS`; a late filer and an unfiled obligation are both
 * non-filers; a request neither granted nor declined is still open), plus a cancelled obligation
 * and another year's obligation and request, which count nowhere; and the compliance facts.
 */
export async function givenProjectedYear(api: ReportingApi): Promise<void> {
  const at = new Date('2027-11-15T09:00:00.000Z');
  for (const [tenant, counts] of Object.entries(RELEASE_COUNTS)) {
    const rows: (typeof obligationFacts.$inferInsert)[] = [];
    for (const type of ['initial', 'biennial', 'final'] as const) {
      const { expected, declared } = counts[type];
      for (let i = 0; i < expected; i += 1) {
        const filedOnTime = i < declared;
        // The first non-filer filed late; the rest have not filed.
        const filedLate = i === declared;
        rows.push({
          obligationId: randomUUID(),
          tenant,
          type,
          fy: RELEASE_FY,
          statementDate: '2027-09-01',
          dueDate: '2027-10-01',
          status: filedOnTime || filedLate ? 'filed' : 'overdue',
          statusAt: at,
          filedAt: filedOnTime || filedLate ? at : null,
          late: filedLate,
        });
      }
    }
    rows.push(
      { obligationId: randomUUID(), tenant, type: 'initial', fy: RELEASE_FY, status: 'cancelled' },
      { obligationId: randomUUID(), tenant, type: 'initial', fy: RELEASE_FY - 1, status: 'due' },
    );
    await api.asPlatform(async (tx) => {
      await tx.insert(obligationFacts).values(rows);
      // givenFacts issues one open clarification and those resolved: these make up the rest.
      const others =
        counts.clarifications - 1 - (RELEASE_COMPLIANCE[tenant]?.clarificationsResolved ?? 0);
      for (let i = 0; i < others; i += 1) {
        await tx.insert(clarificationFacts).values({
          clarificationId: randomUUID(),
          tenant,
          caseId: randomUUID(),
          fy: RELEASE_FY,
          issuedAt: at,
          status: 'responded',
          statusAt: at,
        });
      }
      const { received, granted, declined } = counts.accessRequests;
      const request = (fy: number, outcome: 'grant' | 'deny' | null) => ({
        requestId: randomUUID(),
        tenant,
        fy,
        receivedAt: at,
        outcome,
        grounds: outcome === 'deny' ? [ACCESS_GROUNDS[0]] : [],
        closedAt: outcome === null ? null : at,
      });
      await tx
        .insert(accessRequestFacts)
        .values([
          ...Array.from({ length: granted }, () => request(RELEASE_FY, 'grant')),
          ...Array.from({ length: declined }, () => request(RELEASE_FY, 'deny')),
          ...Array.from({ length: received - granted - declined }, () => request(RELEASE_FY, null)),
          request(RELEASE_FY - 1, 'grant'),
        ]);
    });
  }
  for (const [tenant, counts] of Object.entries(RELEASE_COMPLIANCE)) {
    await givenFacts(api, tenant, counts);
  }
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
