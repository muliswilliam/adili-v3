import { HttpStatus, Injectable } from '@nestjs/common';
import { callerOf, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { eq, sql } from 'drizzle-orm';

import type { InstructionPurpose } from '../adapter-kit/lookup-purpose.js';
import { ResilientCalls } from '../adapter-kit/resilient-calls.js';
import { SystemCallLog } from '../adapter-kit/system-call-log.js';
import { payrollInstructions, type schema, type System } from '../db/schema.js';
import { SubjectHasher } from '../verification/subject-hasher.js';
import { PayrollClient } from './payroll-client.js';
import {
  type PayrollInstructionUnacknowledgedData,
  payrollInstructionSubmitted,
  payrollInstructionUnacknowledged,
} from './payroll-events.js';
import type { PayrollInstruction, PayrollInstructionRequest } from './payroll-records.js';

type InstructionRow = typeof payrollInstructions.$inferSelect;

const PAYROLL: System = 'payroll';

/** What tells one instruction from another under the same reference. */
interface Particulars {
  action: PayrollInstructionRequest['action'];
  employerCode: string;
  personalNumberHash: string;
  nationalIdHash: string;
  effectiveDate: string;
}

/** An instruction sent and acknowledged now, or the stored one a replay of its reference finds. */
export interface Submitted {
  instruction: PayrollInstruction;
  replayed: boolean;
}

/**
 * Payroll instructions (spec 08 S15): salary stoppage and reinstatement sent to payroll through
 * the kit (`ResilientCalls`: pause, breaker, rate limit and timeout; never cached), and their
 * acknowledgements stored, idempotent by instruction reference.
 *
 * An instruction already acknowledged answers the stored acknowledgement without calling payroll
 * again; under the same reference with other particulars it is a conflict. One payroll left
 * `pending` is sent again (payroll answers the original) and its row updated once it settles. An instruction payroll
 * does not acknowledge (down, timed out, breaker open, paused) is `upstream-unavailable` and
 * nothing is recorded as sent: the caller's workflow retries, and payroll, idempotent by
 * reference too, answers a retry of an instruction it did receive with the original. Every call
 * to payroll leaves a `system_calls` row for coverage, in one transaction with what it achieved:
 * the acknowledgement stored and `payroll.instruction.submitted.v1`, or, unacknowledged,
 * `payroll.instruction.unacknowledged.v1` alone.
 */
@Injectable()
export class PayrollInstructions {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly calls: ResilientCalls,
    private readonly callLog: SystemCallLog,
    private readonly payroll: PayrollClient,
    private readonly hasher: SubjectHasher,
    private readonly events: EventPublisher,
  ) {}

  async submit(
    request: PayrollInstructionRequest,
    purpose: InstructionPurpose,
    caller: Principal,
  ): Promise<Submitted> {
    const particulars = this.particulars(request);
    const stored = await this.find(request.instructionReference);
    if (stored) {
      const replayed = replay(stored, particulars);
      // A pending acknowledgement is asked again (payroll answers the original) until it settles.
      if (stored.status !== 'pending') return replayed;
    }

    const requestedBy = callerOf(caller);
    const sentAt = new Date();
    const started = performance.now();
    const call = await this.calls.call(PAYROLL, (signal) => this.payroll.submit(request, signal), {
      log: { instructionReference: request.instructionReference },
    });
    const logged = { system: PAYROLL, outcome: call, started, caller: requestedBy };
    const unacknowledged = (reason: PayrollInstructionUnacknowledgedData['reason']) =>
      this.db.transaction(async (tx) => {
        await this.callLog.record(logged, tx);
        await this.events.record(
          tx,
          payrollInstructionUnacknowledged({
            instructionReference: request.instructionReference,
            action: request.action,
            reason,
            legalBasis: purpose.legalBasis,
            caseRef: purpose.caseRef,
            requestedBy,
          }),
        );
      });
    if (call.outcome === 'unavailable') {
      await unacknowledged(call.reason);
      throw new ProblemException({
        type: 'upstream-unavailable',
        title: 'Payroll unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: `Payroll did not acknowledge the instruction (${call.reason}). Nothing was recorded as sent; try again.`,
      });
    }
    const acknowledgement = call.value;
    if (!sameParticulars(this.particulars(acknowledgement), particulars)) {
      await unacknowledged('reference-conflict');
      throw conflict('Payroll holds another instruction under this reference.');
    }

    const row: InstructionRow = {
      instructionReference: request.instructionReference,
      ...particulars,
      status: acknowledgement.status,
      payrollReference: acknowledgement.payrollReference,
      receivedAt: acknowledgement.receivedAt === null ? null : new Date(acknowledgement.receivedAt),
      sentAt,
      requestedBy,
      legalBasis: purpose.legalBasis,
      caseRef: purpose.caseRef,
    };
    const written = await this.db.transaction(async (tx) => {
      await this.callLog.record(logged, tx);
      // A new instruction, or a pending one settled; never a settled one overwritten.
      const [created] = await tx
        .insert(payrollInstructions)
        .values(row)
        .onConflictDoUpdate({
          target: payrollInstructions.instructionReference,
          set: {
            status: row.status,
            payrollReference: row.payrollReference,
            receivedAt: row.receivedAt,
          },
          setWhere: sql`${payrollInstructions.status} = 'pending' and ${payrollInstructions.status} <> ${row.status}`,
        })
        .returning();
      if (!created) return null;
      await this.events.record(
        tx,
        payrollInstructionSubmitted({
          instructionReference: created.instructionReference,
          action: created.action,
          status: created.status,
          payrollReference: created.payrollReference,
          legalBasis: created.legalBasis,
          caseRef: created.caseRef,
          requestedBy,
        }),
      );
      return created;
    });
    if (written) return { instruction: toInstruction(written), replayed: stored !== undefined };

    // The same reference was stored meanwhile (two sends at once), or is still pending: answer as
    // a replay of what is stored.
    const raced = await this.find(request.instructionReference);
    if (!raced) throw new Error('Payroll instruction neither inserted nor found');
    return replay(raced, particulars);
  }

  /** The stored instruction and its acknowledgement; null when none was acknowledged. */
  async read(instructionReference: string): Promise<PayrollInstruction | null> {
    const row = await this.find(instructionReference);
    return row ? toInstruction(row) : null;
  }

  private async find(instructionReference: string): Promise<InstructionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(payrollInstructions)
      .where(eq(payrollInstructions.instructionReference, instructionReference))
      .limit(1);
    return row;
  }

  /** An instruction's particulars, as sent or as payroll acknowledged them, identifiers hashed. */
  private particulars(
    instruction: Pick<
      PayrollInstructionRequest,
      'action' | 'employerCode' | 'personalNumber' | 'nationalId' | 'effectiveDate'
    >,
  ): Particulars {
    return {
      action: instruction.action,
      employerCode: instruction.employerCode,
      personalNumberHash: this.hasher.hash(
        PAYROLL,
        `personal-number:${instruction.personalNumber}`,
      ),
      nationalIdHash: this.hasher.hash(PAYROLL, `national-id:${instruction.nationalId}`),
      effectiveDate: instruction.effectiveDate,
    };
  }
}

/** Whether two instructions under one reference are the same instruction. */
function sameParticulars(one: Particulars, other: Particulars): boolean {
  return (
    one.action === other.action &&
    one.employerCode === other.employerCode &&
    one.personalNumberHash === other.personalNumberHash &&
    one.nationalIdHash === other.nationalIdHash &&
    one.effectiveDate === other.effectiveDate
  );
}

function replay(stored: InstructionRow, particulars: Particulars): Submitted {
  if (!sameParticulars(stored, particulars)) {
    throw conflict('Another instruction was sent under this reference.');
  }
  return { instruction: toInstruction(stored), replayed: true };
}

function conflict(detail: string): ProblemException {
  return new ProblemException({
    type: 'instruction-reference-conflict',
    title: 'Instruction reference already used',
    status: HttpStatus.CONFLICT,
    detail,
  });
}

function toInstruction(row: InstructionRow): PayrollInstruction {
  return {
    instructionReference: row.instructionReference,
    action: row.action,
    status: row.status,
    payrollReference: row.payrollReference,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    sentAt: row.sentAt.toISOString(),
  };
}
