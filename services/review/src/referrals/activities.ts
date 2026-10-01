import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ApplicationFailure } from '@temporalio/common';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  lte,
  notExists,
  sql,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import { OPEN_CLARIFICATION_STATUSES, clarifications, reviewCases } from '../cases/schema.js';
import { Clock, nairobiDate } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import {
  administrativeActions,
  enforcementLadders,
  ISSUED_ACTION_STATUSES,
} from '../enforcement/schema.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import {
  type ClarificationSweepChunk,
  type ClarificationSweepResult,
  EVIDENCE_MISSING,
  type ManifestOutcome,
  type MissedCyclesCandidates,
  type MissedCyclesOutcome,
  type MissedCyclesPage,
  PACKAGE_REFUSED,
  type PackageOutcome,
  type PersonRef,
  REFERRAL_MISSING,
  type ReferralSendingInput,
  type ReferralSweepPlan,
  type SentOutcome,
} from './contract.js';
import { collectEvidence, EvidenceMissing, planEvidence } from './evidence-package.js';
import { REFERRAL_SENT, type ReferralSentData } from './events.js';
import { ladderWindowDays, twoMissedCycles } from './missed-cycles.js';
import { eventBase, issuedActionsOf, recordProposed } from './referrals.service.js';
import { referrals } from './schema.js';

/** The template version of `referral-package` this service's payload fills. */
export const REFERRAL_PACKAGE_TEMPLATE_VERSION = 1;

/**
 * The activities of the referral workflows (spec 08), hosted by the review worker. Every public
 * method is an activity named after it (keep helpers out of this class); each is safe to retry:
 * the sweep proposes once per person, grounds and cycle (a unique index), and the sending stores
 * the manifest, the package and the sending once each.
 */
@Injectable()
export class ReferralActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
  ) {}

  /** The Commissions with enforcement ladders, read across tenants, and the run's Nairobi date. */
  async referralSweepTenants(): Promise<ReferralSweepPlan> {
    const rows = await withTenant(this.db, { tenant: 'platform', subject: SYSTEM_SUBJECT }, (tx) =>
      tx
        .selectDistinct({ tenant: enforcementLadders.tenant })
        .from(enforcementLadders)
        .orderBy(asc(enforcementLadders.tenant)),
    );
    return { tenants: rows.map((row) => row.tenant), runDate: nairobiDate(this.clock.now()) };
  }

  /**
   * The persons of the Commission with a ladder on an overdue obligation that has not closed
   * (still running, or declined), after `after` in id order, at most `limit`: the only ones who can
   * have missed a cycle past the ladder.
   */
  async missedCyclesCandidates({
    tenant,
    after,
    limit,
  }: MissedCyclesPage): Promise<MissedCyclesCandidates> {
    const rows = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .selectDistinct({ personId: enforcementLadders.personId })
        .from(enforcementLadders)
        .where(
          and(
            eq(enforcementLadders.tenant, tenant),
            eq(enforcementLadders.subjectKind, 'obligation'),
            inArray(enforcementLadders.status, ['active', 'declined']),
            isNotNull(enforcementLadders.personId),
            after === null ? undefined : gt(enforcementLadders.personId, after),
          ),
        )
        .orderBy(asc(enforcementLadders.personId))
        .limit(limit),
    );
    const personIds = rows.flatMap((row) => (row.personId === null ? [] : [row.personId]));
    return { personIds, next: personIds.length === limit ? (personIds.at(-1) ?? null) : null };
  }

  /**
   * Proposes `two-missed-cycles` for the person when their obligation history (declarations)
   * shows two consecutive biennial cycles overdue and unfiled after the ladder window, once per
   * cycle: the obligations and their ladders' issued steps are its sources.
   */
  async proposeMissedCycles({ tenant, personId }: PersonRef): Promise<MissedCyclesOutcome> {
    const now = this.clock.now();
    const history = await this.declarations.listPersonObligations(personId, tenant);
    const windowDays = ladderWindowDays(await this.directory.getLadderPolicy(tenant));
    const missed = twoMissedCycles(history, nairobiDate(now), windowDays);
    if (!missed) return 'none';
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      // The ladders name the declarant (the roster's name and file number); the later cycle's first.
      const [ladder] = await tx
        .select({
          declarantName: enforcementLadders.declarantName,
          personnelFileNumber: enforcementLadders.personnelFileNumber,
        })
        .from(enforcementLadders)
        .where(
          and(
            eq(enforcementLadders.personId, personId),
            eq(enforcementLadders.subjectKind, 'obligation'),
          ),
        )
        .orderBy(
          sql`${enforcementLadders.subjectId} = ${missed.obligationIds[1]} desc`,
          desc(enforcementLadders.startedAt),
        )
        .limit(1);
      if (!ladder) return 'none';
      const [created] = await tx
        .insert(referrals)
        .values({
          id: uuidv7(),
          tenant,
          personId,
          caseId: null,
          cycleYear: missed.cycleYear,
          grounds: 'two-missed-cycles',
          proposerKind: 'system',
          proposer: null,
          proposedAt: now,
          sources: {
            caseIds: [],
            flagIds: [],
            clarificationIds: [],
            obligationIds: [...missed.obligationIds],
            actionIds: await issuedActionsOf(tx, missed.obligationIds),
          },
          narrative: `Proposed by the system: the biennial declarations of the ${String(missed.earlierCycleYear)} and ${String(missed.cycleYear)} cycles are overdue and not filed, more than ${String(windowDays)} days after the later one was due: past the notice, warning and salary stoppage windows (Regs r.20(2)).`,
          status: 'proposed',
          declarantName: ladder.declarantName,
          personnelFileNumber: ladder.personnelFileNumber,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) return 'already-proposed';
      await recordProposed(tx, this.events, created);
      return 'proposed';
    });
  }

  /**
   * Proposes `unanswered-clarification` for up to `limit` clarifications of the Commission whose
   * ladder is still running (so the declarant never answered) and reached salary stoppage: its
   * stoppage was issued and that window has ended (spec 08: "clarifications whose ladder reached
   * the stoppage window without response"). A ladder held on an earlier step is not proposed,
   * however long it has run. Once per person and cycle: the case, the clarification and the
   * ladder's issued steps are its sources.
   */
  async proposeUnansweredClarifications({
    tenant,
    limit,
  }: ClarificationSweepChunk): Promise<ClarificationSweepResult> {
    const now = this.clock.now();
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const rows = await tx
        .select({
          ladder: enforcementLadders,
          clarificationId: clarifications.id,
          personId: clarifications.personId,
          caseId: reviewCases.id,
          cycleYear: reviewCases.cycleYear,
        })
        .from(enforcementLadders)
        .innerJoin(clarifications, eq(clarifications.id, enforcementLadders.subjectId))
        .innerJoin(reviewCases, eq(reviewCases.id, clarifications.caseId))
        .where(
          and(
            eq(enforcementLadders.tenant, tenant),
            eq(enforcementLadders.subjectKind, 'clarification'),
            eq(enforcementLadders.status, 'active'),
            exists(
              tx
                .select({ one: sql`1` })
                .from(administrativeActions)
                .where(
                  and(
                    eq(administrativeActions.ladderId, enforcementLadders.id),
                    eq(administrativeActions.step, 'salary-stoppage'),
                    inArray(administrativeActions.status, ISSUED_ACTION_STATUSES),
                    lte(administrativeActions.windowEndsAt, now),
                  ),
                ),
            ),
            inArray(clarifications.status, OPEN_CLARIFICATION_STATUSES),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(referrals)
                .where(
                  and(
                    eq(referrals.tenant, enforcementLadders.tenant),
                    eq(referrals.personId, clarifications.personId),
                    eq(referrals.grounds, 'unanswered-clarification'),
                    eq(referrals.proposerKind, 'system'),
                    eq(referrals.cycleYear, reviewCases.cycleYear),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(enforcementLadders.startedAt), asc(enforcementLadders.id))
        .limit(limit);
      let proposed = 0;
      for (const row of rows) {
        const [created] = await tx
          .insert(referrals)
          .values({
            id: uuidv7(),
            tenant,
            personId: row.personId,
            caseId: row.caseId,
            cycleYear: row.cycleYear,
            grounds: 'unanswered-clarification',
            proposerKind: 'system',
            proposer: null,
            proposedAt: now,
            sources: {
              caseIds: [row.caseId],
              flagIds: [],
              clarificationIds: [row.clarificationId],
              obligationIds: [],
              actionIds: await issuedActionsOf(tx, [row.clarificationId]),
            },
            narrative: `Proposed by the system: clarification ${row.ladder.subjectReference} is not answered, and the ladder is past the notice, warning and salary stoppage windows (Regs r.20(2)).`,
            status: 'proposed',
            declarantName: row.ladder.declarantName,
            personnelFileNumber: row.ladder.personnelFileNumber,
          })
          .onConflictDoNothing()
          .returning();
        if (!created) continue;
        await recordProposed(tx, this.events, created);
        proposed += 1;
      }
      return { scanned: rows.length, proposed };
    });
  }

  /**
   * Pulls the approved referral's evidence and stores its manifest, once: every version of the
   * source cases (declarations, read as the service for the case), the flags, the clarifications
   * with their responses, the obligations, and the letters' hashes (documents). Nothing of it
   * leaves this activity but the count.
   */
  async buildManifest({ tenant, referralId }: ReferralSendingInput): Promise<ManifestOutcome> {
    const { referral, plan } = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const found = await load(tx, referralId, false);
      return { referral: found, plan: await planEvidence(tx, found) };
    });
    if (referral.status === 'proposed' || referral.status === 'declined') {
      return { outcome: 'not-approved' };
    }
    if (referral.packageManifest !== null) {
      return { outcome: 'already-built', items: referral.packageManifest.length };
    }
    let manifest;
    try {
      ({ manifest } = await collectEvidence(
        { declarations: this.declarations, documents: this.documents },
        referral,
        plan,
      ));
    } catch (error) {
      if (error instanceof EvidenceMissing) {
        throw ApplicationFailure.nonRetryable(
          `Evidence of referral ${referralId} is missing`,
          EVIDENCE_MISSING,
        );
      }
      throw error;
    }
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const locked = await load(tx, referralId, true);
      if (locked.packageManifest !== null) {
        return { outcome: 'already-built', items: locked.packageManifest.length };
      }
      await tx
        .update(referrals)
        .set({ packageManifest: manifest })
        .where(eq(referrals.id, referralId));
      return { outcome: 'built', items: manifest.length };
    });
  }

  /**
   * Asks documents to issue the Confidential `referral-package` (ADR-010), once. The request names
   * the referral only; documents pulls the cover sheet, manifest and evidence from
   * `internalGetReferralPackagePayload`. No person owns it: the declarant cannot download it.
   */
  async issuePackage({ tenant, referralId }: ReferralSendingInput): Promise<PackageOutcome> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const referral = await load(tx, referralId, true);
      if (referral.packageDocumentId !== null) return 'already-issued';
      if (referral.packageManifest === null) {
        throw new Error(`Referral ${referralId} has no manifest yet`);
      }
      let issued;
      try {
        issued = await this.documents.issue(
          {
            type: 'referral-package',
            templateVersion: REFERRAL_PACKAGE_TEMPLATE_VERSION,
            subjectRef: `referral:${referralId}`,
            subjectPersonId: null,
            payload: { referralId },
          },
          tenant,
        );
      } catch (error) {
        if (error instanceof InternalApiRejected) {
          throw ApplicationFailure.nonRetryable(
            `Documents refused the package of referral ${referralId} (${String(error.status)})`,
            PACKAGE_REFUSED,
          );
        }
        throw error;
      }
      await tx
        .update(referrals)
        .set({ packageDocumentId: issued.id, packageVerificationId: issued.verificationId })
        .where(eq(referrals.id, referralId));
      return 'issued';
    });
  }

  /**
   * Marks the referral sent, once, with `referral.sent.v1` for EACC's intake (spec 09). No message
   * to the declarant (spec 08).
   */
  async markSent({ tenant, referralId }: ReferralSendingInput): Promise<SentOutcome> {
    const now = this.clock.now();
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const referral = await load(tx, referralId, true);
      if (referral.status === 'sent') return 'already-sent';
      const { approver, reference, packageDocumentId } = referral;
      if (
        referral.status !== 'approved' ||
        approver === null ||
        reference === null ||
        packageDocumentId === null
      ) {
        throw new Error(`Referral ${referralId} is not ready to send`);
      }
      const [sent] = await tx
        .update(referrals)
        .set({ status: 'sent', sentAt: now })
        .where(eq(referrals.id, referralId))
        .returning();
      if (!sent) throw new Error(`Referral ${referralId} was not marked sent`);
      await this.events.record<ReferralSentData>(tx, {
        type: REFERRAL_SENT,
        subject: referralId,
        tenant,
        data: {
          ...eventBase(sent),
          approver,
          reference,
          packageDocumentId,
          sentAt: now.toISOString(),
        },
      });
      return 'sent';
    });
  }
}

/** The referral, locked for update when `lock` is set; one that does not exist is not retried. */
async function load(tx: ReviewTransaction, referralId: string, lock: boolean) {
  const query = tx.select().from(referrals).where(eq(referrals.id, referralId));
  const [found] = lock ? await query.for('update') : await query;
  if (!found) {
    throw ApplicationFailure.nonRetryable(
      `Referral ${referralId} does not exist`,
      REFERRAL_MISSING,
    );
  }
  return found;
}
