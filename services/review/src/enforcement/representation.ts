import type { ProposerKind } from '../approvals/schema.js';
import type { Assignee } from '../cases/representation.js';
import { officer } from '../determinations/representation.js';
import type { ActionRow, LadderRow } from './ladder-records.js';
import {
  ACTION_STEPS,
  type ActionStatus,
  type ActionStep,
  type ClosingCause,
  type LadderStatus,
  type PayrollAcknowledgement,
  type SubjectKind,
} from './schema.js';

/** review.yaml `AdministrativeAction`. */
export interface ActionView {
  id: string;
  ladderId: string;
  step: ActionStep;
  status: ActionStatus;
  proposerKind: ProposerKind;
  proposer: Assignee | null;
  proposedAt: string;
  approver: Assignee | null;
  approvedAt: string | null;
  declinedBy: Assignee | null;
  declinedAt: string | null;
  declineNote: string | null;
  issuedAt: string | null;
  windowEndsAt: string | null;
  reference: string | null;
  letter: { documentId: string; verificationId: string } | null;
  response: {
    text: string;
    attachments: { uploadId: string; fileName: string }[];
    submittedAt: string;
  } | null;
  payrollStop: PayrollAcknowledgement | null;
  payrollResume: PayrollAcknowledgement | null;
}

/** review.yaml `Ladder`. */
export interface LadderView {
  id: string;
  subjectKind: SubjectKind;
  subjectId: string;
  subjectReference: string;
  declarantName: string;
  personnelFileNumber: string;
  status: LadderStatus;
  closingCause: ClosingCause | null;
  currentStep: ActionStep | null;
  steps: ActionView[];
  startedAt: string;
  endedAt: string | null;
}

export function actionView(row: ActionRow): ActionView {
  return {
    id: row.id,
    ladderId: row.ladderId,
    step: row.step,
    status: row.status,
    proposerKind: row.proposerKind,
    proposer: officer(row.proposer, row.proposerName),
    proposedAt: row.proposedAt.toISOString(),
    approver: officer(row.approver, row.approverName),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    declinedBy: officer(row.declinedBy, row.declinedByName),
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineNote: row.declineNote,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    reference: row.reference,
    letter:
      row.letterDocumentId !== null && row.letterVerificationId !== null
        ? { documentId: row.letterDocumentId, verificationId: row.letterVerificationId }
        : null,
    response: responseView(row),
    payrollStop: row.payrollStopAck,
    payrollResume: row.payrollResumeAck,
  };
}

/** The declarant's response as views show it: text, attachments by name, when. */
export function responseView(row: ActionRow): ActionView['response'] {
  if (row.response === null) return null;
  return {
    text: row.response.text,
    attachments: row.response.attachments.map(({ uploadId, fileName }) => ({ uploadId, fileName })),
    submittedAt: row.response.submittedAt,
  };
}

/** The ladder with its steps in ladder order: by run, then step, then when drafted. */
export function ladderView(ladder: LadderRow, actions: readonly ActionRow[]): LadderView {
  const steps = [...actions].sort(
    (a, b) =>
      a.run - b.run ||
      ACTION_STEPS.indexOf(a.step) - ACTION_STEPS.indexOf(b.step) ||
      a.proposedAt.getTime() - b.proposedAt.getTime(),
  );
  const current = steps.find((action) => action.id === ladder.currentActionId) ?? steps.at(-1);
  return {
    id: ladder.id,
    subjectKind: ladder.subjectKind,
    subjectId: ladder.subjectId,
    subjectReference: ladder.subjectReference,
    declarantName: ladder.declarantName,
    personnelFileNumber: ladder.personnelFileNumber,
    status: ladder.status,
    closingCause: ladder.closingCause,
    currentStep: current?.step ?? null,
    steps: steps.map(actionView),
    startedAt: ladder.startedAt.toISOString(),
    endedAt: ladder.endedAt?.toISOString() ?? null,
  };
}
