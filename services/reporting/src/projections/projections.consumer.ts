import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { TENANT_SLUG } from '../access.js';
import { financialYearAt, financialYearOf } from '../financial-year.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import {
  ACTION_APPROVED,
  ACTION_CANCELLED,
  ACTION_COMPLIED,
  ACTION_DECLINED,
  ACTION_ISSUED,
  ACTION_PROPOSED,
  ACTION_RESPONDED,
  actionData,
  CLARIFICATION_ISSUED,
  CLARIFICATION_OVERDUE,
  CLARIFICATION_RESOLVED,
  CLARIFICATION_RESPONDED,
  CLARIFICATION_WITHDRAWN,
  clarificationData,
  DECLARATION_SUBMITTED,
  declarationSubmittedData,
  DETERMINATION_APPROVED,
  determinationApprovedData,
  OBLIGATION_CREATED,
  OBLIGATION_STATUS_CHANGED,
  obligationCreatedData,
  obligationStatusChangedData,
  REFERRAL_SENT,
  referralSentData,
} from './events.js';
import {
  actionFacts,
  type ActionStatus,
  clarificationFacts,
  type ClarificationFactStatus,
  determinationFacts,
  obligationFacts,
  referralFacts,
} from './schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The inbox consumer name of an event type, e.g. `reporting.obligation.created.v1`. */
export function consumerOf(type: string): string {
  return `reporting.${type}`;
}

/**
 * Builds the facts Form M is compiled from (spec 09, ADR-013 §3). Each event is projected once
 * (inbox), in one transaction with its inbox record, under its Commission's row-level security.
 * Every projection writes only the columns its event knows, so the facts converge whatever order
 * the events arrive in. A handler that throws (a malformed event) is retried once, then
 * dead-lettered. Each handler resolves to false for an event already projected.
 */
@Controller()
export class ProjectionsConsumer {
  constructor(@InjectDatabase() private readonly db: Database) {}

  @OnEvent(OBLIGATION_CREATED)
  obligationCreated(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = obligationCreatedData.parse(event.data);
    const facts = {
      rosterRecordId: data.rosterRecordId,
      type: data.type,
      cycleKey: data.cycleKey,
      // Initial by appointment date, biennial by the cycle's statement date, final by exit date:
      // each is the obligation's statement date.
      fy: financialYearOf(data.statementDate),
      statementDate: data.statementDate,
      dueDate: data.dueDate,
    };
    return this.project(event, (tx, tenant) =>
      tx
        .insert(obligationFacts)
        .values({ obligationId: data.obligationId, tenant, ...facts })
        .onConflictDoUpdate({ target: obligationFacts.obligationId, set: facts }),
    );
  }

  @OnEvent(OBLIGATION_STATUS_CHANGED)
  obligationStatusChanged(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = obligationStatusChangedData.parse(event.data);
    const at = new Date(event.time);
    return this.project(event, (tx, tenant) =>
      tx
        .insert(obligationFacts)
        .values({ obligationId: data.obligationId, tenant, status: data.to, statusAt: at })
        .onConflictDoUpdate({
          target: obligationFacts.obligationId,
          set: newerStatus(obligationFacts.status, obligationFacts.statusAt),
        }),
    );
  }

  @OnEvent(DECLARATION_SUBMITTED)
  declarationSubmitted(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = declarationSubmittedData.parse(event.data);
    const at = new Date(event.time);
    return this.project(event, async (tx, tenant) => {
      // An amendment replaces a filed declaration: version 1 filed the obligation.
      if (data.amendment) return;
      await tx
        .insert(obligationFacts)
        .values({ obligationId: data.obligationId, tenant, filedAt: at, late: data.late })
        .onConflictDoUpdate({
          target: obligationFacts.obligationId,
          set: {
            filedAt: sql`coalesce(${obligationFacts.filedAt}, excluded.filed_at)`,
            late: sql`coalesce(${obligationFacts.late}, excluded.late)`,
          },
        });
    });
  }

  @OnEvent(CLARIFICATION_ISSUED)
  clarificationIssued(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.clarification(event, 'issued');
  }

  @OnEvent(CLARIFICATION_RESPONDED)
  clarificationResponded(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.clarification(event, 'responded');
  }

  @OnEvent(CLARIFICATION_RESOLVED)
  clarificationResolved(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.clarification(event, 'resolved');
  }

  @OnEvent(CLARIFICATION_OVERDUE)
  clarificationOverdue(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.clarification(event, 'overdue');
  }

  @OnEvent(CLARIFICATION_WITHDRAWN)
  clarificationWithdrawn(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.clarification(event, 'withdrawn');
  }

  @OnEvent(ACTION_PROPOSED)
  actionProposed(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'proposed');
  }

  @OnEvent(ACTION_APPROVED)
  actionApproved(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'approved');
  }

  @OnEvent(ACTION_DECLINED)
  actionDeclined(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'declined');
  }

  @OnEvent(ACTION_ISSUED)
  actionIssued(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'issued');
  }

  @OnEvent(ACTION_RESPONDED)
  actionResponded(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'responded');
  }

  @OnEvent(ACTION_COMPLIED)
  actionComplied(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'complied');
  }

  @OnEvent(ACTION_CANCELLED)
  actionCancelled(@Payload() event: EventEnvelope): Promise<boolean> {
    return this.action(event, 'cancelled');
  }

  @OnEvent(DETERMINATION_APPROVED)
  determinationApproved(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = determinationApprovedData.parse(event.data);
    const at = new Date(event.time);
    return this.project(event, (tx, tenant) =>
      tx
        .insert(determinationFacts)
        .values({
          determinationId: data.determinationId,
          tenant,
          caseId: data.caseId,
          outcome: data.outcome,
          fy: financialYearAt(at),
          approvedAt: at,
        })
        .onConflictDoNothing(),
    );
  }

  @OnEvent(REFERRAL_SENT)
  referralSent(@Payload() event: EventEnvelope): Promise<boolean> {
    const data = referralSentData.parse(event.data);
    const at = new Date(event.time);
    return this.project(event, (tx, tenant) =>
      tx
        .insert(referralFacts)
        .values({
          referralId: data.referralId,
          tenant,
          reference: data.reference,
          grounds: data.grounds,
          fy: financialYearAt(at),
          sentAt: at,
        })
        .onConflictDoNothing(),
    );
  }

  /** A clarification's status; issuing also dates it into the financial year it was issued in. */
  private clarification(event: EventEnvelope, status: ClarificationFactStatus): Promise<boolean> {
    const data = clarificationData.parse(event.data);
    const at = new Date(event.time);
    const dated = {
      ...(status === 'issued' ? { fy: financialYearAt(at), issuedAt: at } : {}),
      ...(status === 'responded' ? { respondedAt: at } : {}),
      ...(status === 'resolved' ? { resolvedAt: at } : {}),
    };
    return this.project(event, (tx, tenant) =>
      tx
        .insert(clarificationFacts)
        .values({
          clarificationId: data.clarificationId,
          tenant,
          caseId: data.caseId,
          status,
          statusAt: at,
          ...dated,
        })
        .onConflictDoUpdate({
          target: clarificationFacts.clarificationId,
          set: {
            ...newerStatus(clarificationFacts.status, clarificationFacts.statusAt),
            ...dated,
          },
        }),
    );
  }

  /** An administrative action's status; its issue and the compliance that ended it are dated. */
  private action(event: EventEnvelope, status: ActionStatus): Promise<boolean> {
    const data = actionData.parse(event.data);
    const at = new Date(event.time);
    const dated = {
      ...(status === 'issued' ? { issuedAt: at } : {}),
      ...(status === 'complied' ? { compliedAt: at } : {}),
    };
    return this.project(event, (tx, tenant) =>
      tx
        .insert(actionFacts)
        .values({
          actionId: data.actionId,
          tenant,
          subjectKind: data.subjectKind,
          subjectId: data.subjectId,
          step: data.step,
          status,
          statusAt: at,
          ...dated,
        })
        .onConflictDoUpdate({
          target: actionFacts.actionId,
          set: { ...newerStatus(actionFacts.status, actionFacts.statusAt), ...dated },
        }),
    );
  }

  /** Runs `work` once per event, under the event's Commission. */
  private async project(
    event: EventEnvelope,
    work: (tx: Transaction, tenant: string) => Promise<unknown>,
  ): Promise<boolean> {
    const tenant = event.tenant;
    if (tenant === undefined || !TENANT_SLUG.test(tenant)) {
      throw new Error(`${event.type} ${event.id} names no Commission`);
    }
    return consumeOnce(this.db, consumerOf(event.type), event, async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant', ${tenant}, true), set_config('app.subject', ${SYSTEM_SUBJECT}, true)`,
      );
      await work(tx, tenant);
    });
  }
}

/**
 * The `set` of an upsert that moves a status only for an event at least as recent as the one
 * that set it, so a late redelivery of an older event cannot move it back.
 */
function newerStatus(status: PgColumn, statusAt: PgColumn): Record<string, SQL> {
  const newer = sql`(${statusAt} is null or ${statusAt} <= excluded.status_at)`;
  return {
    status: sql`case when ${newer} then excluded.status else ${status} end`,
    statusAt: sql`case when ${newer} then excluded.status_at else ${statusAt} end`,
  };
}
