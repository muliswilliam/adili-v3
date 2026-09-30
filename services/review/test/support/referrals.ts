import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import {
  administrativeActions,
  clarificationResponses,
  clarifications,
  enforcementLadders,
  referrals,
  reviewFlags,
} from '../../src/db/schema.js';
import type { SubjectKind } from '../../src/enforcement/schema.js';
import type { ReferralView } from '../../src/referrals/representation.js';
import type { Caller, ReviewApi } from './review-api.js';

/** A flag of a case's version, arranged directly (the processing workflow raises real ones). */
export async function givenFlag(
  api: ReviewApi,
  tenant: string,
  caseId: string,
  versionId: string,
  ruleId: string,
): Promise<string> {
  const id = uuidv7();
  await api.asPlatform((tx) =>
    tx.insert(reviewFlags).values({
      id,
      tenant,
      caseId,
      versionId,
      ruleId,
      severity: 'high',
      title: `Flag ${ruleId}`,
      indicator: 'An indicator for the reviewer, never a finding.',
      evidence: { changePercent: 140, registry: 'ntsa' },
      itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'officer' }],
    }),
  );
  return id;
}

export interface GivenClarification {
  clarificationId: string;
  letterDocumentId: string;
  /** SHA-256 the fake documents service gives its letter. */
  letterSha256: string;
  /** SHA-256 of the response's one attachment, when answered. */
  attachmentSha256: string | null;
}

/**
 * An issued clarification of a case, arranged directly with its letter (known to the fake
 * documents service): `overdue` and unanswered by default, or `responded` with one attachment.
 */
export async function givenIssuedClarification(
  api: ReviewApi,
  {
    tenant,
    caseId,
    personId,
    reference,
    status = 'overdue',
  }: {
    tenant: string;
    caseId: string;
    personId: string;
    reference: string;
    status?: 'overdue' | 'issued' | 'responded' | 'draft';
  },
): Promise<GivenClarification> {
  const clarificationId = uuidv7();
  const letterDocumentId = randomUUID();
  const draft = status === 'draft';
  const letterSha256 = api.documents.givenIssuedDocument(
    tenant,
    letterDocumentId,
    'clarification-letter',
  );
  const attachmentSha256 = status === 'responded' ? 'a'.repeat(64) : null;
  await api.asPlatform(async (tx) => {
    await tx.insert(clarifications).values({
      id: clarificationId,
      tenant,
      caseId,
      personId,
      reference: draft ? null : reference,
      status,
      items: [
        {
          id: randomUUID(),
          sectionKey: 'officer',
          personKey: 'officer',
          itemId: null,
          requirement: 'explain-discrepancy',
          text: 'Explain the vehicle registered in your name.',
        },
      ],
      issuedAt: draft ? null : new Date('2027-12-12T09:00:00.000Z'),
      dueAt: draft ? null : new Date('2027-12-26T09:00:00.000Z'),
      letterDocumentId: draft ? null : letterDocumentId,
      letterVerificationId: draft ? null : 'ADL-TEST',
      createdBy: 'reviewer-a',
    });
    if (status === 'responded' && attachmentSha256 !== null) {
      await tx.insert(clarificationResponses).values({
        clarificationId,
        tenant,
        personId,
        items: [{ itemId: randomUUID(), text: 'It belongs to my brother.' }],
        attachments: [
          {
            itemId: randomUUID(),
            uploadId: randomUUID(),
            fileName: 'logbook.pdf',
            sha256: attachmentSha256,
          },
        ],
      });
    }
  });
  return { clarificationId, letterDocumentId, letterSha256, attachmentSha256 };
}

export interface GivenLadder {
  ladderId: string;
  /** Its issued notice to comply. */
  actionId: string;
  actionReference: string;
  letterSha256: string;
}

/**
 * The enforcement ladder of a subject, arranged directly, with its notice to comply issued (letter
 * known to the fake documents service): running since `startedAt` unless said otherwise.
 */
export async function givenLadder(
  api: ReviewApi,
  {
    tenant,
    subjectKind,
    subjectId,
    personId,
    caseId = null,
    subjectReference,
    startedAt,
    status = 'active',
    declarantName = 'Grace Wanjiru',
    personnelFileNumber = 'PSC/00417',
    actionReference,
  }: {
    tenant: string;
    subjectKind: SubjectKind;
    subjectId: string;
    personId: string;
    caseId?: string | null;
    subjectReference: string;
    startedAt: Date;
    status?: 'active' | 'complied' | 'declined' | 'ended';
    declarantName?: string;
    personnelFileNumber?: string;
    actionReference: string;
  },
): Promise<GivenLadder> {
  const ladderId = uuidv7();
  const actionId = uuidv7();
  const letterDocumentId = randomUUID();
  const letterSha256 = api.documents.givenIssuedDocument(
    tenant,
    letterDocumentId,
    'notice-to-comply',
  );
  await api.asPlatform(async (tx) => {
    await tx.insert(enforcementLadders).values({
      id: ladderId,
      tenant,
      subjectKind,
      subjectId,
      personId,
      rosterRecordId: randomUUID(),
      caseId,
      subjectReference,
      declarantName,
      personnelFileNumber,
      status,
      startedAt,
    });
    await tx.insert(administrativeActions).values({
      id: actionId,
      tenant,
      ladderId,
      run: 1,
      subjectKind,
      subjectId,
      personId,
      step: 'notice-to-comply',
      status: 'issued',
      proposerKind: 'system',
      proposedAt: startedAt,
      approver: 'reviewer-n',
      approvedAt: startedAt,
      issuedAt: startedAt,
      windowEndsAt: new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000),
      reference: actionReference,
      letterDocumentId,
      letterVerificationId: 'ADL-TEST',
    });
    await tx
      .update(enforcementLadders)
      .set({ currentActionId: actionId })
      .where(eq(enforcementLadders.id, ladderId));
  });
  return { ladderId, actionId, actionReference, letterSha256 };
}

/** A reviewer's referral from a case, as `caller`. */
export function proposeReferral(api: ReviewApi, caseId: string, caller: Caller, body: unknown) {
  return api.send('POST', `/v1/review/cases/${caseId}/referrals`, caller, body);
}

/** Approval of a referral as `caller`, with an idempotency key. */
export function approveReferral(api: ReviewApi, referralId: string, caller: Caller) {
  return api.send('POST', `/v1/review/referrals/${referralId}/approve`, caller, undefined, {
    'idempotency-key': randomUUID(),
  });
}

/** Decline of a referral as `caller`, with a note. */
export function declineReferral(
  api: ReviewApi,
  referralId: string,
  caller: Caller,
  reason: string,
) {
  return api.send('POST', `/v1/review/referrals/${referralId}/decline`, caller, { reason });
}

/** Every referral row, oldest first. */
export async function referralRows(api: ReviewApi) {
  return api.asPlatform((tx) => tx.select().from(referrals).orderBy(referrals.proposedAt));
}

/** Waits until the referral, as `caller` reads it, is `sent` (the sending runs on Temporal). */
export function sentReferral(
  api: ReviewApi,
  referralId: string,
  caller: Caller,
): Promise<ReferralView> {
  return vi.waitFor(
    async () => {
      const response = await api.get(`/v1/review/referrals/${referralId}`, caller);
      const referral = response.json<ReferralView>();
      if (referral.status !== 'sent') throw new Error(`referral ${referral.status}`);
      return referral;
    },
    { timeout: 45_000, interval: 250 },
  );
}

/**
 * A referral already `sent` to EACC, arranged directly (the sending workflow is S13's): an assets
 * referral from `caseId`, or a system `two-missed-cycles` one with no case when `caseId` is null.
 */
export async function givenSentReferral(
  api: ReviewApi,
  {
    tenant,
    personId,
    caseId,
    reference,
    status = 'sent',
  }: {
    tenant: string;
    personId: string;
    caseId: string | null;
    reference: string;
    status?: 'approved' | 'sent';
  },
): Promise<string> {
  const id = uuidv7();
  const at = new Date('2027-12-20T06:00:00.000Z');
  await api.asPlatform((tx) =>
    tx.insert(referrals).values({
      id,
      tenant,
      personId,
      caseId,
      cycleYear: 2027,
      grounds: caseId === null ? 'two-missed-cycles' : 'undeclared-assets',
      proposerKind: caseId === null ? 'system' : 'user',
      proposer: caseId === null ? null : 'reviewer-a',
      proposerName: caseId === null ? null : 'Amina Wafula',
      proposedAt: new Date('2027-12-18T09:00:00.000Z'),
      sources: {
        caseIds: caseId === null ? [] : [caseId],
        flagIds: [],
        clarificationIds: [],
        obligationIds: [],
        actionIds: [],
      },
      narrative: 'NTSA records a vehicle registered to the officer that is not declared.',
      status,
      approver: 'supervisor-s',
      approverName: 'Samuel Njoroge',
      approvedAt: at,
      reference,
      packageManifest: [],
      packageDocumentId: status === 'sent' ? randomUUID() : null,
      packageVerificationId: status === 'sent' ? 'ADL-TEST' : null,
      sentAt: status === 'sent' ? at : null,
      declarantName: 'James Otieno',
      personnelFileNumber: 'PSC/00042',
    }),
  );
  return id;
}

/** `referral.icms-registered.v1` as reporting publishes it and the RabbitMQ transport delivers it. */
export function icmsRegisteredEvent(
  tenant: string,
  data: { referralId: string; icmsCaseNumber: string; registeredAt: string },
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/reporting',
    type: 'referral.icms-registered.v1',
    time: new Date().toISOString(),
    subject: data.referralId,
    datacontenttype: 'application/json',
    tenant,
    data: { tenant, ...data },
  };
}
