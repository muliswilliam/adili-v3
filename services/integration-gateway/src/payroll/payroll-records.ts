import { z } from 'zod';

import { PAYROLL_ACTIONS, PAYROLL_STATUSES } from '../db/schema.js';
import { NATIONAL_ID } from '../registries/registry-records.js';

// The internal API (packages/schemas/internal/integration-gateway.yaml), within payroll's own
// limits (external/payroll.yaml `InstructionRequest`), so payroll never refuses what we accept.

/** An `ADM` reference, or it with `-R`: payroll keeps up to 40 characters. */
export const INSTRUCTION_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;
/** An employer code as payroll writes them, e.g. `KEMSA`: up to 20 characters. */
const PAYROLL_EMPLOYER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
/**
 * A personal number (the roster's personnel file number, e.g. `KEMSA/2011/0457`), as the
 * directory takes them, within payroll's 20 characters.
 */
const PERSONAL_NUMBER = /^[A-Za-z0-9/.-]{1,20}$/;

export const payrollActionSchema = z.enum(PAYROLL_ACTIONS);
export const payrollStatusSchema = z.enum(PAYROLL_STATUSES);

export const instructionReferenceSchema = z
  .string()
  .regex(INSTRUCTION_REFERENCE, 'must be an instruction reference of at most 40 characters');

/**
 * A stop or resume salary instruction (`PayrollInstructionRequest`). Personal data (personal
 * number, national ID): it travels to payroll in the body, never in a URL, and is kept only as
 * keyed hashes.
 */
export const payrollInstructionRequestSchema = z
  .strictObject({
    instructionReference: instructionReferenceSchema.meta({
      description: 'The ADM reference (stop) or ADM reference with -R suffix (resume)',
    }),
    employerCode: z.string().regex(PAYROLL_EMPLOYER_CODE, 'must be an employer code'),
    personalNumber: z.string().regex(PERSONAL_NUMBER, 'must be a personal number'),
    nationalId: z.string().regex(NATIONAL_ID, 'must be 5 to 10 digits'),
    action: payrollActionSchema,
    reason: z.string().trim().min(1).max(500),
    effectiveDate: z.iso.date(),
  })
  .meta({ description: 'A stop or resume salary instruction for payroll' });
export type PayrollInstructionRequest = z.infer<typeof payrollInstructionRequestSchema>;

/** The instruction as payroll acknowledged it (`PayrollInstruction`). */
export const payrollInstructionSchema = z
  .object({
    instructionReference: z.string(),
    action: payrollActionSchema,
    status: payrollStatusSchema.meta({
      description: 'Currently always accepted; pending and failed are reserved',
    }),
    payrollReference: z.string().nullable().meta({
      description:
        "Payroll's own reference. Currently always present; null is reserved for a pending instruction",
    }),
    receivedAt: z.iso.datetime({ offset: true }).nullable().meta({
      description:
        "When payroll received it, by payroll's clock. Currently always present; null is reserved for a pending instruction",
    }),
    sentAt: z.iso
      .datetime({ offset: true })
      .meta({ description: 'When the gateway sent the instruction payroll acknowledged' }),
  })
  .meta({
    description:
      'A payroll instruction and its acknowledgement. Payroll accepts an instruction as it receives it, so the gateway currently always answers accepted with a payroll reference; pending and failed are reserved',
  });
export type PayrollInstruction = z.infer<typeof payrollInstructionSchema>;

// Payroll's own shapes (packages/schemas/external/payroll.yaml).

/**
 * external/payroll.yaml `Instruction`, the acknowledgement of `submitInstruction` (201 received,
 * 200 a resubmission of the same reference answering the original). Payroll's `StatusEnum` is
 * only `accepted`, with its reference and time; `pending` and `failed`, without them, are taken
 * too, reserved for a payroll that acknowledges asynchronously.
 */
export const payrollAcknowledgementSchema = z
  .object({
    payroll_reference: z.string().min(1).nullish(),
    instruction_reference: z.string().min(1),
    employer_code: z.string(),
    personal_number: z.string(),
    id_number: z.string(),
    action: payrollActionSchema,
    effective_date: z.iso.date(),
    status: payrollStatusSchema,
    received_at: z.iso.datetime({ offset: true }).nullish(),
  })
  .transform((ack) => ({
    payrollReference: ack.payroll_reference ?? null,
    instructionReference: ack.instruction_reference,
    employerCode: ack.employer_code,
    personalNumber: ack.personal_number,
    nationalId: ack.id_number,
    action: ack.action,
    effectiveDate: ack.effective_date,
    status: ack.status,
    receivedAt: ack.received_at ?? null,
  }));
export type PayrollAcknowledgement = z.output<typeof payrollAcknowledgementSchema>;
