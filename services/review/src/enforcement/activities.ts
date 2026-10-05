import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { ApplicationFailure } from '@temporalio/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import { clarifications, reviewCases } from '../cases/schema.js';
import { portal } from '../clarifications/links.js';
import { Clock, nairobiDate } from '../clock.js';
import { config } from '../config.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { issueLetter } from '../documents/letters.js';
import {
  IntegrationGatewayClient,
  type PayrollAction,
  type PayrollInstruction,
  type PayrollInstructionRequest,
} from '../integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { NotificationsClient, type ReviewTemplate } from '../notifications/notifications-client.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import {
  ACTION_LETTER_REFUSED,
  type ActionDecision,
  type ActionLetterOutcome,
  type ActionNotice,
  type ActionNoticeOutcome,
  type ActionRef,
  type CloseRequest,
  type EnforcementInput,
  type IssuedAction,
  LADDER_MISSING,
  type LadderRef,
  type OpenedLadder,
  PAYROLL_REFUSED,
  type Reinstatement,
  type SalaryStopOutcome,
  type StepRequest,
} from './contract.js';
import {
  ACTION_DISCIPLINARY_REFERRED,
  ACTION_ISSUED,
  ACTION_PROPOSED,
  type DisciplinaryReferredData,
} from './events.js';
import {
  ACTION_LETTER_TEMPLATE_VERSION,
  type ActionRow,
  closeLadderRecords,
  type LadderRow,
  recordAction,
  recordHistory,
  STEP_LABELS,
  STEP_LETTERS,
} from './ladder-records.js';
import {
  payrollReason,
  recordInstructionAcknowledged,
  recordInstructionSent,
  resumeReference,
} from './payroll-records.js';
import { administrativeActions, type ClosingCause, enforcementLadders } from './schema.js';
import { type DemoLadderWindows, stepWindowEndsAt } from './windows.js';

/** Namespace of the actions' ids: one action per ladder, run and step. */
const ACTION_ID_NAMESPACE = '3c1f9a7e-52d4-4b8e-9f06-7a2d4e8b1c53';

/** Namespace of the messages' idempotency keys: one key per action and template. */
const MESSAGE_KEY_NAMESPACE = 'd6a0e4b2-7f19-4c3a-8e5d-1b9c2f7a6e04';

/** The portal page where the declarant reads and answers a notice. */
export function portalNoticeUrl(actionId: string): string {
  return portal(`notices/${actionId}`);
}

const DEMO_LADDER_WINDOWS: DemoLadderWindows = {
  notice: config.DEMO_LADDER_NOTICE_WINDOW,
  warning: config.DEMO_LADDER_WARNING_WINDOW,
  stoppage: config.DEMO_LADDER_STOPPAGE_WINDOW,
};

/** What the ladder is about and whom it addresses, as its subject stands now. */
type Subject =
  | { standing: 'missing' }
  | { standing: 'not-owed'; cause: ClosingCause | null }
  | {
      standing: 'owed';
      facts: {
        personId: string | null;
        rosterRecordId: string | null;
        caseId: string | null;
        subjectReference: string;
        declarantName: string;
        personnelFileNumber: string;
      };
    };

/** One payroll instruction of a salary stoppage, before it is sent. */
interface Instruction {
  action: PayrollAction;
  reference: string;
  effectiveDate: string;
}

/**
 * The activities of `EnforcementWorkflow`, hosted by the review worker. Every public method is an
 * activity named after it (keep helpers out of this class); each is safe to retry. An unreachable
 * declarations, documents, notifications or directory service, or integration-gateway, propagates,
 * so Temporal retries.
 */
@Injectable()
export class EnforcementActivities {
  private readonly logger = new Logger(EnforcementActivities.name);

  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly notifications: NotificationsClient,
    private readonly gateway: IntegrationGatewayClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * The ladder of the subject: started (with the subject's facts pulled once) when the subject is
   * still overdue or unanswered, or the one a supervisor just restarted. A subject no longer owed
   * closes a ladder still open; a ladder that ended is not started again by a repeated event.
   */
  async openLadder(input: EnforcementInput): Promise<OpenedLadder> {
    const { tenant, subjectKind, subjectId } = input;
    const subject = await subjectOf(this.db, this.declarations, input);
    const now = this.clock.now();
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [existing] = await tx
        .select()
        .from(enforcementLadders)
        .where(
          and(
            eq(enforcementLadders.tenant, tenant),
            eq(enforcementLadders.subjectKind, subjectKind),
            eq(enforcementLadders.subjectId, subjectId),
          ),
        )
        .for('update');
      if (subject.standing === 'missing') return { outcome: 'missing' };
      if (subject.standing === 'not-owed') {
        if (existing && subject.cause !== null) {
          await closeLadderRecords(tx, this.events, existing.id, subject.cause, now);
        }
        return { outcome: 'not-owed', cause: subject.cause };
      }
      if (existing) {
        return existing.status === 'active'
          ? { outcome: 'opened', ladderId: existing.id }
          : { outcome: 'closed' };
      }
      const ladderId = uuidv7();
      await tx.insert(enforcementLadders).values({
        id: ladderId,
        tenant,
        subjectKind,
        subjectId,
        ...subject.facts,
        status: 'active',
        run: 1,
        startedAt: now,
      });
      await recordHistory(tx, tenant, ladderId, 'ladder-started', SYSTEM_SUBJECT, now);
      return { outcome: 'opened', ladderId };
    });
  }

  /**
   * Drafts the step (`system`) on the ladder's current run, once: its id is derived from the
   * ladder, run and step, so a retry finds it. The ladder then shows it as its current step.
   */
  async proposeStep({ tenant, ladderId, step }: StepRequest): Promise<{ actionId: string }> {
    const now = this.clock.now();
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [ladder] = await tx
        .select()
        .from(enforcementLadders)
        .where(eq(enforcementLadders.id, ladderId))
        .for('update');
      if (!ladder) {
        throw ApplicationFailure.nonRetryable(`Ladder ${ladderId} does not exist`, LADDER_MISSING);
      }
      const actionId = uuidv5(`${ladderId}:${String(ladder.run)}:${step}`, ACTION_ID_NAMESPACE);
      if (ladder.status !== 'active') return { actionId };
      const [proposed] = await tx
        .insert(administrativeActions)
        .values({
          id: actionId,
          tenant,
          ladderId,
          run: ladder.run,
          subjectKind: ladder.subjectKind,
          subjectId: ladder.subjectId,
          personId: ladder.personId,
          rosterRecordId: ladder.rosterRecordId,
          step,
          status: 'proposed',
          proposerKind: 'system',
          proposedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (proposed) {
        await tx
          .update(enforcementLadders)
          .set({ currentActionId: actionId })
          .where(eq(enforcementLadders.id, ladderId));
        await recordAction(tx, this.events, proposed, {
          kind: 'action-proposed',
          type: ACTION_PROPOSED,
          actor: SYSTEM_SUBJECT,
          at: now,
        });
      }
      return { actionId };
    });
  }

  /** Where the step stands: still waiting, approved, declined, or closed with its ladder. */
  async actionDecision({ tenant, actionId }: ActionRef): Promise<ActionDecision> {
    const [found] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({ status: administrativeActions.status })
        .from(administrativeActions)
        .where(eq(administrativeActions.id, actionId)),
    );
    switch (found?.status) {
      case 'proposed':
        return 'proposed';
      case 'approved':
      case 'approved-pending-payroll':
      case 'issued':
      case 'responded':
        return 'approved';
      case 'declined':
        return 'declined';
      default:
        return 'closed';
    }
  }

  /**
   * Asks documents to issue the step's Restricted letter (ADR-010), once. Its window is set first,
   * from the Commission's ladder policy and the time the letter is asked for, and committed, so
   * the letter payload documents pulls says by when to act. The request names the action only.
   */
  async issueLetter({ tenant, actionId }: ActionRef): Promise<ActionLetterOutcome> {
    const windowed = await withWindow(this.db, this.directory, this.clock, tenant, actionId);
    if (windowed.letterDocumentId !== null) return 'already-requested';
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [action] = await tx
        .select()
        .from(administrativeActions)
        .where(eq(administrativeActions.id, actionId))
        .for('update');
      if (!action) throw missing(actionId);
      if (action.letterDocumentId !== null) return 'already-requested';
      if (action.reference === null || action.issuedAt === null) {
        throw new Error(`Action ${actionId} is approved without a reference`);
      }
      const issued = await issueLetter(this.documents, {
        type: STEP_LETTERS[action.step],
        payload: { actionId },
        tenant,
        templateVersion: ACTION_LETTER_TEMPLATE_VERSION,
        subjectRef: `action:${actionId}`,
        subjectPersonId: action.personId,
        refused: ACTION_LETTER_REFUSED,
      });
      await tx
        .update(administrativeActions)
        .set({ letterDocumentId: issued.id, letterVerificationId: issued.verificationId })
        .where(eq(administrativeActions.id, actionId));
      return 'requested';
    });
  }

  /**
   * Tells the declarant of the issued step, by person, on one channel: what it is, its reference
   * and by when to act (a salary stoppage also from when the salary is stopped); or, with
   * `reinstatement`, that the stopped salary is reinstated. The same message always carries the
   * same idempotency key, so a retry is not delivered twice; a message notifications refuses is
   * not retried. An officer who never onboarded has no person to tell (`skipped`).
   */
  async notifyAction({
    tenant,
    actionId,
    channel,
    reinstatement = false,
  }: ActionNotice): Promise<ActionNoticeOutcome> {
    const action = await load(this.db, tenant, actionId);
    if (action.personId === null) return 'skipped';
    const commission = await this.directory.getCommission(tenant);
    const { template, params } = messageOf(action, channel, reinstatement, commission.name);
    try {
      const sent = await this.notifications.send({
        channel,
        personId: action.personId,
        template,
        params,
        tenant,
        idempotencyKey: uuidv5(`${actionId}:${template}`, MESSAGE_KEY_NAMESPACE),
      });
      return sent.status;
    } catch (error) {
      if (!(error instanceof InternalApiRejected)) throw error;
      this.logger.warn(
        { actionId, template, status: error.status },
        'Notifications refused a notice message',
      );
      return 'rejected';
    }
  }

  /**
   * The approved step becomes `issued`, with the history entry and `action.issued.v1`, once;
   * returns when its window ends. An issued disciplinary referral also records
   * `action.disciplinary-referred.v1` for the employer, with the reporting entity of its roster
   * record. A step the ladder's closing overtook is left as it is.
   */
  async markIssued({ tenant, actionId }: ActionRef): Promise<IssuedAction> {
    const now = this.clock.now();
    const before = await load(this.db, tenant, actionId);
    const referral = before.step === 'disciplinary-referral' && before.status === 'approved';
    const roster =
      referral && before.rosterRecordId !== null
        ? await this.directory.getRosterRecord(tenant, before.rosterRecordId)
        : null;
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const action = await lockAction(tx, actionId);
      if (action.issuedAt === null) throw new Error(`Action ${actionId} has no letter requested`);
      if (action.status === 'approved') {
        const [issued] = await tx
          .update(administrativeActions)
          .set({ status: 'issued' })
          .where(eq(administrativeActions.id, actionId))
          .returning();
        if (issued) {
          await recordAction(tx, this.events, issued, {
            kind: 'action-issued',
            type: ACTION_ISSUED,
            actor: SYSTEM_SUBJECT,
            at: now,
          });
          if (issued.step === 'disciplinary-referral') {
            await this.events.record<DisciplinaryReferredData>(tx, {
              type: ACTION_DISCIPLINARY_REFERRED,
              subject: issued.id,
              tenant,
              data: {
                actionId: issued.id,
                ladderId: issued.ladderId,
                subjectKind: issued.subjectKind,
                subjectId: issued.subjectId,
                step: issued.step,
                proposerKind: issued.proposerKind,
                approver: issued.approver,
                ...(issued.reference === null ? {} : { reference: issued.reference }),
                personId: issued.personId,
                rosterRecordId: issued.rosterRecordId,
                reportingEntityId: roster?.reportingEntityId ?? null,
              },
            });
          }
        }
      }
      return { windowEndsAt: action.windowEndsAt?.toISOString() ?? null };
    });
  }

  /**
   * Sends the approved salary stoppage's `stop_salary` instruction through the integration-gateway
   * and stores payroll's acknowledgement, once: the instruction reference is the stoppage's `ADM`
   * reference, so a retried send or a replayed approval never stops a salary twice. The roster
   * facts (employer code, personal number, national ID) are read from the directory at send time
   * and go to the gateway only. While payroll has not acknowledged, the stoppage is
   * `approved-pending-payroll` and the activity is retried with backoff; a refusal is not retried.
   */
  async stopSalary({ tenant, actionId }: ActionRef): Promise<SalaryStopOutcome> {
    const { action, ladder } = await loadWithLadder(this.db, tenant, actionId);
    if (action.payrollStopAck !== null) return 'stopped';
    if (action.reference === null) throw new Error(`Action ${actionId} has no reference`);
    const sent = await sendInstruction(
      {
        db: this.db,
        directory: this.directory,
        gateway: this.gateway,
        events: this.events,
        clock: this.clock,
      },
      ladder,
      action,
      {
        action: 'stop_salary',
        reference: action.reference,
        effectiveDate: action.salaryStopEffectiveDate ?? nairobiDate(this.clock.now()),
      },
    );
    return sent ? 'stopped' : 'no-roster-record';
  }

  /**
   * When the ladder closes (compliance, or the subject gone), reinstates its stopped salary: `resume_salary` through the
   * integration-gateway (reference: the stoppage's `ADM` reference with `-R`), the acknowledgement
   * stored and the stoppage `reinstated`, once. Returns the stoppage reinstated (again, on a
   * retry), or null when no salary was stopped.
   */
  async reinstateSalary({ tenant, ladderId }: LadderRef): Promise<Reinstatement> {
    const [stoppage] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({ action: administrativeActions, ladder: enforcementLadders })
        .from(administrativeActions)
        .innerJoin(enforcementLadders, eq(enforcementLadders.id, administrativeActions.ladderId))
        .where(
          and(
            eq(administrativeActions.ladderId, ladderId),
            eq(administrativeActions.step, 'salary-stoppage'),
            isNotNull(administrativeActions.payrollStopAck),
          ),
        )
        .orderBy(desc(administrativeActions.run))
        .limit(1),
    );
    if (!stoppage) return { actionId: null };
    const { action, ladder } = stoppage;
    if (action.payrollResumeAck !== null) return { actionId: action.id };
    if (action.reference === null) throw new Error(`Action ${action.id} has no reference`);
    const sent = await sendInstruction(
      {
        db: this.db,
        directory: this.directory,
        gateway: this.gateway,
        events: this.events,
        clock: this.clock,
      },
      ladder,
      action,
      {
        action: 'resume_salary',
        reference: resumeReference(action.reference),
        effectiveDate: nairobiDate(this.clock.now()),
      },
    );
    // The roster record the salary was stopped on is gone: retried until the directory has it.
    if (!sent) throw new Error(`No roster record to reinstate action ${action.id} on`);
    return { actionId: action.id };
  }

  /** Closes the ladder for `cause` (compliance, or the subject gone), once. */
  async closeLadder({ tenant, ladderId, cause }: CloseRequest): Promise<boolean> {
    const now = this.clock.now();
    return withTenant(this.db, systemContext(tenant), (tx) =>
      closeLadderRecords(tx, this.events, ladderId, cause, now),
    );
  }
}

/** What sending a payroll instruction uses. */
interface PayrollDeps {
  db: Database<ReviewSchema>;
  directory: DirectoryClient;
  gateway: IntegrationGatewayClient;
  events: EventPublisher;
  clock: Clock;
}

/**
 * One payroll instruction of a stoppage: recorded as sent, sent, and its acknowledgement stored.
 * False when there is no roster record to send it for (nothing recorded or sent).
 */
async function sendInstruction(
  deps: PayrollDeps,
  ladder: LadderRow,
  action: ActionRow,
  instruction: Instruction,
): Promise<boolean> {
  const { tenant } = action;
  if (action.rosterRecordId === null || action.reference === null) return false;
  const roster = await deps.directory.getRosterRecord(tenant, action.rosterRecordId);
  if (!roster) return false;
  const commission = await deps.directory.getCommission(tenant);
  const recorded = await withTenant(deps.db, systemContext(tenant), async (tx) => {
    const locked = await lockAction(tx, action.id);
    return recordInstructionSent(tx, deps.events, locked, instruction, deps.clock.now());
  });
  const request: PayrollInstructionRequest = {
    instructionReference: instruction.reference,
    // The directory's roster record has no employer code yet: the Commission's issuer code.
    employerCode: roster.employerCode ?? commission.issuerCode,
    personalNumber: roster.personalNumber,
    nationalId: roster.nationalId,
    action: instruction.action,
    reason: payrollReason(instruction.action, ladder, action.reference),
    effectiveDate:
      instruction.action === 'stop_salary'
        ? (recorded.salaryStopEffectiveDate ?? instruction.effectiveDate)
        : instruction.effectiveDate,
  };
  let acknowledged: PayrollInstruction;
  try {
    acknowledged = await deps.gateway.submitPayrollInstruction(request, {
      tenant,
      ...(ladder.caseId === null ? {} : { caseRef: ladder.caseId }),
    });
  } catch (error) {
    if (error instanceof InternalApiRejected) {
      throw ApplicationFailure.nonRetryable(
        `The integration-gateway refused ${instruction.action} of action ${action.id} (${String(error.status)})`,
        PAYROLL_REFUSED,
      );
    }
    throw error;
  }
  if (acknowledged.status === 'failed') {
    throw ApplicationFailure.nonRetryable(
      `Payroll failed ${instruction.action} of action ${action.id}`,
      PAYROLL_REFUSED,
    );
  }
  if (acknowledged.status === 'pending') {
    // Not yet acknowledged: sent again (idempotent by reference) until payroll accepts it.
    throw new Error(`Payroll has not yet acknowledged ${instruction.action} of ${action.id}`);
  }
  await withTenant(deps.db, systemContext(tenant), async (tx) => {
    const locked = await lockAction(tx, action.id);
    await recordInstructionAcknowledged(tx, deps.events, locked, acknowledged, deps.clock.now());
  });
  return true;
}

/**
 * The action with its issue time and window set: from now and the policy, the first time it is
 * asked for (a disciplinary referral has no window).
 */
async function withWindow(
  db: Database<ReviewSchema>,
  directory: DirectoryClient,
  clock: Clock,
  tenant: string,
  actionId: string,
): Promise<ActionRow> {
  const action = await load(db, tenant, actionId);
  if (action.issuedAt !== null) return action;
  const policy = await directory.getLadderPolicy(tenant);
  const issuedAt = clock.now();
  const windowEndsAt = stepWindowEndsAt(issuedAt, policy, action.step, DEMO_LADDER_WINDOWS);
  const [set] = await withTenant(db, systemContext(tenant), (tx) =>
    tx
      .update(administrativeActions)
      .set({ issuedAt, windowEndsAt })
      .where(eq(administrativeActions.id, actionId))
      .returning(),
  );
  return set ?? action;
}

/** The subject as it stands now: an obligation from declarations, a clarification from here. */
async function subjectOf(
  db: Database<ReviewSchema>,
  declarations: DeclarationsClient,
  { tenant, subjectKind, subjectId }: EnforcementInput,
): Promise<Subject> {
  if (subjectKind === 'obligation') {
    const obligation = await declarations.getObligation(subjectId, tenant);
    if (!obligation) return { standing: 'missing' };
    switch (obligation.status) {
      case 'overdue':
        return {
          standing: 'owed',
          facts: {
            personId: obligation.personId,
            rosterRecordId: obligation.rosterRecordId,
            caseId: null,
            subjectReference: obligation.cycleKey,
            declarantName: obligation.declarantName,
            personnelFileNumber: obligation.personnelFileNumber,
          },
        };
      case 'filed':
        return { standing: 'not-owed', cause: 'filed' };
      case 'cancelled':
        return { standing: 'not-owed', cause: 'obligation-cancelled' };
      default:
        return { standing: 'not-owed', cause: null };
    }
  }
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx
      .select({
        clarification: clarifications,
        rosterRecordId: reviewCases.rosterRecordId,
        declarantName: reviewCases.declarantName,
        personnelFileNumber: reviewCases.personnelFileNumber,
      })
      .from(clarifications)
      .innerJoin(reviewCases, eq(reviewCases.id, clarifications.caseId))
      .where(eq(clarifications.id, subjectId)),
  );
  if (!found) return { standing: 'missing' };
  const { clarification } = found;
  switch (clarification.status) {
    case 'overdue':
      return {
        standing: 'owed',
        facts: {
          personId: clarification.personId,
          // The case's: its salary is stopped and resumed on the declaration's roster record.
          rosterRecordId: found.rosterRecordId,
          caseId: clarification.caseId,
          subjectReference: clarification.reference ?? clarification.id,
          declarantName: found.declarantName,
          personnelFileNumber: found.personnelFileNumber,
        },
      };
    case 'responded':
      return { standing: 'not-owed', cause: 'clarification-responded' };
    case 'resolved':
      return { standing: 'not-owed', cause: 'clarification-resolved' };
    case 'withdrawn':
      return { standing: 'not-owed', cause: 'clarification-withdrawn' };
    default:
      return { standing: 'not-owed', cause: null };
  }
}

/**
 * The message telling the declarant of an issued step, or of the salary reinstated: its template
 * on the channel and the parameters the template renders.
 */
function messageOf(
  action: ActionRow,
  channel: ActionNotice['channel'],
  reinstatement: boolean,
  commission: string,
): { template: ReviewTemplate; params: Record<string, string> } {
  if (action.reference === null) throw new Error(`Action ${action.id} has no reference`);
  const portalUrl = portalNoticeUrl(action.id);
  if (reinstatement) {
    if (action.salaryReinstatedAt === null) {
      throw new Error(`Action ${action.id} has no salary reinstated`);
    }
    return {
      template: `salary-reinstated-${channel}` as const,
      params: {
        commission,
        reference: action.reference,
        reinstatedOn: nairobiDate(action.salaryReinstatedAt),
        portalUrl,
      },
    };
  }
  if (action.windowEndsAt === null) throw new Error(`Action ${action.id} has no window`);
  const actBy = nairobiDate(action.windowEndsAt);
  if (action.step === 'salary-stoppage') {
    if (action.salaryStopEffectiveDate === null) {
      throw new Error(`Action ${action.id} has no salary stopped`);
    }
    return {
      template: `salary-stopped-${channel}` as const,
      params: {
        commission,
        reference: action.reference,
        stoppedFrom: action.salaryStopEffectiveDate,
        actBy,
        portalUrl,
      },
    };
  }
  return {
    template: `notice-${channel}` as const,
    params: {
      commission,
      reference: action.reference,
      step: STEP_LABELS[action.step],
      actBy,
      portalUrl,
    },
  };
}

function missing(actionId: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(`Action ${actionId} does not exist`, LADDER_MISSING);
}

/** The action, read as the service; one that does not exist fails without retry. */
async function load(db: Database<ReviewSchema>, tenant: string, actionId: string) {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx.select().from(administrativeActions).where(eq(administrativeActions.id, actionId)),
  );
  if (!found) throw missing(actionId);
  return found;
}

/** The action, locked for update in `tx`; one that does not exist fails without retry. */
async function lockAction(tx: ReviewTransaction, actionId: string): Promise<ActionRow> {
  const [found] = await tx
    .select()
    .from(administrativeActions)
    .where(eq(administrativeActions.id, actionId))
    .for('update');
  if (!found) throw missing(actionId);
  return found;
}

/** The action and its ladder, read as the service. */
async function loadWithLadder(
  db: Database<ReviewSchema>,
  tenant: string,
  actionId: string,
): Promise<{ action: ActionRow; ladder: LadderRow }> {
  const [found] = await withTenant(db, systemContext(tenant), (tx) =>
    tx
      .select({ action: administrativeActions, ladder: enforcementLadders })
      .from(administrativeActions)
      .innerJoin(enforcementLadders, eq(enforcementLadders.id, administrativeActions.ladderId))
      .where(eq(administrativeActions.id, actionId)),
  );
  if (!found) throw missing(actionId);
  return found;
}
