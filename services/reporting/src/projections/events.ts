import { z } from 'zod';

import { ACTION_STEPS, OBLIGATION_TYPES } from './schema.js';

/**
 * The events the reporting service projects (spec 09 backend detail), and the identifiers it
 * reads from each. Producers: declarations (spec 04 obligations, spec 06 submission), review
 * (spec 07a clarifications, spec 07c copilot, spec 08 determinations, actions and referrals) and
 * the ai-gateway (spec 07c ratings). Every event carries
 * the Commission in its `tenant` extension; the time an event happened is its envelope `time`.
 */

export const OBLIGATION_CREATED = 'obligation.created.v1';
export const OBLIGATION_STATUS_CHANGED = 'obligation.status-changed.v1';
export const DECLARATION_SUBMITTED = 'declaration.submitted.v1';

export const CLARIFICATION_ISSUED = 'clarification.issued.v1';
export const CLARIFICATION_RESPONDED = 'clarification.responded.v1';
export const CLARIFICATION_RESOLVED = 'clarification.resolved.v1';
export const CLARIFICATION_OVERDUE = 'clarification.overdue.v1';
export const CLARIFICATION_WITHDRAWN = 'clarification.withdrawn.v1';

export const ACTION_PROPOSED = 'action.proposed.v1';
export const ACTION_APPROVED = 'action.approved.v1';
export const ACTION_DECLINED = 'action.declined.v1';
export const ACTION_ISSUED = 'action.issued.v1';
export const ACTION_RESPONDED = 'action.responded.v1';
export const ACTION_COMPLIED = 'action.complied.v1';
export const ACTION_CANCELLED = 'action.cancelled.v1';

export const DETERMINATION_APPROVED = 'determination.approved.v1';
export const REFERRAL_SENT = 'referral.sent.v1';

export const COPILOT_UPDATED = 'review.copilot.updated.v1';
export const AI_FEEDBACK_RECORDED = 'ai.feedback.recorded.v1';

const civilDate = z.iso.date();

/**
 * The person an event is about, by id only, where its producer carries it (spec 09 projections
 * keep `person_id`); absent or null otherwise, and never a name.
 */
const personId = z.uuid().nullish();

/** `obligation.created.v1` (declarations, spec 04). */
export const obligationCreatedData = z.object({
  obligationId: z.uuid(),
  personId,
  rosterRecordId: z.uuid(),
  type: z.enum(OBLIGATION_TYPES),
  cycleKey: z.string().min(1),
  statementDate: civilDate,
  dueDate: civilDate,
});

/** `obligation.status-changed.v1` (declarations, spec 04). */
export const obligationStatusChangedData = z.object({
  obligationId: z.uuid(),
  to: z.enum(['upcoming', 'due', 'overdue', 'filed', 'cancelled']),
});

/** `declaration.submitted.v1` (declarations, spec 06): an amendment files nothing new. */
export const declarationSubmittedData = z.object({
  obligationId: z.uuid(),
  amendment: z.boolean(),
  late: z.boolean(),
});

/** Every `clarification.*` event (review, spec 07a). */
export const clarificationData = z.object({
  clarificationId: z.uuid(),
  caseId: z.uuid(),
  personId,
});

/**
 * Every `action.*` event (review, spec 08 #206 `ActionEventData`): the action, its ladder, the
 * subject the ladder enforces, the step and the person where the event carries it. The events also
 * carry the proposer kind, the approver, the `ADM` reference and what closed the ladder, which
 * Form M does not need.
 */
export const actionData = z.object({
  actionId: z.uuid(),
  ladderId: z.uuid(),
  subjectKind: z.enum(['obligation', 'clarification']),
  subjectId: z.uuid(),
  step: z.enum(ACTION_STEPS),
  personId,
});

/** `determination.approved.v1` (review, spec 08). */
export const determinationApprovedData = z.object({
  determinationId: z.uuid(),
  caseId: z.uuid(),
  outcome: z.string().min(1),
});

/**
 * review.yaml `ReferralGrounds` (spec 08 #212): undeclared or unexplained assets (a reviewer's
 * proposal), or two missed cycles and an unanswered clarification (the referral sweep's).
 */
export const REFERRAL_GROUNDS = [
  'undeclared-assets',
  'unexplained-assets',
  'two-missed-cycles',
  'unanswered-clarification',
] as const;
export type ReferralGrounds = (typeof REFERRAL_GROUNDS)[number];

/**
 * `referral.sent.v1` (review, spec 08 #212 `ReferralSentData`): what every `referral.*` event
 * carries (the referral, its Commission, grounds, cycle, the person referred by id and who
 * proposed it) and, once sent, the approver, the `RFL` reference, the Confidential evidence
 * package's document id and when it was sent. Identifiers only: no names.
 */
export const referralSentData = z.object({
  referralId: z.uuid(),
  tenant: z.string().min(1),
  grounds: z.enum(REFERRAL_GROUNDS),
  cycleYear: z.number().int(),
  personId: z.uuid(),
  proposerKind: z.enum(['system', 'user']),
  approver: z.string().min(1),
  reference: z.string().min(1),
  packageDocumentId: z.uuid(),
  sentAt: z.iso.datetime({ offset: true }),
});
export type ReferralSentData = z.infer<typeof referralSentData>;

/** `review.copilot.updated.v1` (review, spec 07c): the copilot of a case changed status. */
export const copilotUpdatedData = z.object({
  caseId: z.uuid(),
  status: z.enum(['not-enabled', 'pending', 'ready', 'failed', 'stale']),
});

/**
 * `ai.feedback.recorded.v1` (ai-gateway, spec 07c): an officer rated an output. A rating changed
 * later comes again under the same `feedbackId`. No note and no officer: nothing to keep out.
 */
export const aiFeedbackRecordedData = z.object({
  feedbackId: z.uuid(),
  jobId: z.uuid(),
  task: z.string().min(1),
  rating: z.enum(['helpful', 'not-helpful']),
  reason: z.enum(['inaccurate', 'missed-something', 'unclear', 'too-long', 'other']).nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
});
