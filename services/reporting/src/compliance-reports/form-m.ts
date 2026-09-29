import type { FormMV1 } from '@adili/forms';

import type { OfficerDetails } from '../declarations/declarations-client.js';
import { periodOf } from '../financial-year.js';
import {
  ACTION_STEPS,
  type ActionStatus,
  type ActionStep,
  type ClarificationFactStatus,
  type ObligationType,
} from '../projections/schema.js';
import type { ClarificationDetails } from '../review/review-client.js';
import type { Aggregate } from './contract.js';
import type { ReportCounts, SectionCounts } from './schema.js';

/**
 * Form M from the projections (spec 09), as pure functions: the counts and lists of `aggregate`,
 * and the `form-m.v1` document `assemble` builds from them, the details pulled by id and what the
 * Commission's officers entered on the previous draft.
 */

type NonFilerRow = FormMV1['partII']['initial']['nonFilers'][number];
type ClarificationRow = FormMV1['partII']['clarifications']['items'][number];

/** An obligation fact as the aggregate reads it. */
export interface ObligationFactRow {
  obligationId: string;
  type: ObligationType | null;
  statementDate: string | null;
  status: string | null;
  filedAt: Date | null;
  late: boolean | null;
}

/** A clarification fact as the aggregate reads it. */
export interface ClarificationFactRow {
  clarificationId: string;
  issuedAt: Date | null;
}

/**
 * Counts per section and the officers who did not declare. Expected: the obligations the year
 * holds by statement date (appointed, in service, exited), cancelled ones aside. Declared: filed
 * on time. Everyone else is on the section's list, late filers included, so the report says
 * whether they complied. A year with no biennial obligation has no cycle (`noCycleInPeriod`).
 * Access requests are zeros until spec 10 projects them.
 */
export function aggregateFacts(
  obligations: readonly ObligationFactRow[],
  clarifications: readonly ClarificationFactRow[],
): Aggregate {
  const section = (type: ObligationType) => {
    const owed = obligations
      .filter((row) => row.type === type && row.status !== 'cancelled')
      .sort(
        (a, b) =>
          (a.statementDate ?? '').localeCompare(b.statementDate ?? '') ||
          a.obligationId.localeCompare(b.obligationId),
      );
    const nonFilers = owed.filter((row) => !filedOnTime(row)).map((row) => row.obligationId);
    const counts: SectionCounts = {
      expected: owed.length,
      declared: owed.length - nonFilers.length,
      notDeclared: nonFilers.length,
    };
    return { counts, nonFilers };
  };
  const initial = section('initial');
  const biennial = section('biennial');
  const final = section('final');
  const clarificationIds = [...clarifications]
    .sort(
      (a, b) =>
        (a.issuedAt?.getTime() ?? 0) - (b.issuedAt?.getTime() ?? 0) ||
        a.clarificationId.localeCompare(b.clarificationId),
    )
    .map((row) => row.clarificationId);
  const counts: ReportCounts = {
    initial: initial.counts,
    biennial: { ...biennial.counts, noCycleInPeriod: biennial.counts.expected === 0 },
    final: final.counts,
    clarifications: clarificationIds.length,
    accessRequests: { received: 0, granted: 0, declined: 0 },
  };
  return {
    counts,
    nonFilers: {
      initial: initial.nonFilers,
      biennial: biennial.nonFilers,
      final: final.nonFilers,
    },
    clarificationIds,
  };
}

function filed(row: ObligationFactRow): boolean {
  return row.filedAt !== null || row.status === 'filed';
}

function filedOnTime(row: ObligationFactRow): boolean {
  return filed(row) && row.late !== true;
}

/** An action on a non-filer's obligation, as the action facts hold it. */
export interface ActionFactRow {
  subjectId: string;
  step: ActionStep;
  status: ActionStatus;
}

/** Statuses of an action that reached the officer: issued, answered, or ended by compliance. */
const TAKEN: readonly ActionStatus[] = ['issued', 'responded', 'complied', 'reinstated'];

/** The default remark of a row: the latest action step taken, in words. */
export const ACTION_LABELS: Record<NonFilerRow['actionTaken'], string> = {
  none: 'No administrative action taken',
  'notice-to-comply': 'Notice to comply issued',
  warning: 'Warning issued',
  'salary-stoppage': 'Salary stopped',
  'disciplinary-referral': 'Referred for disciplinary action',
  'referred-to-eacc': 'Referred to EACC',
};

/** What the Commission's officers entered on a draft, kept across recompiles. */
export interface ManualEntries {
  contactDetails: string;
  physicalAddress: string;
  emailAddress: string;
  complaints: FormMV1['partII']['complaints'];
  partIII: FormMV1['partIII'];
}

/** Nothing entered yet: Part I contacts blank, Part B unanswered, Part III unsigned. */
export const NO_MANUAL_ENTRIES: ManualEntries = {
  contactDetails: '',
  physicalAddress: '',
  emailAddress: '',
  complaints: { registerMaintained: null, items: [] },
  partIII: {
    compiledBy: { name: null, designation: null, date: null },
    confirmedBy: { name: null, designation: null, date: null },
  },
};

/** The entries of the previous draft, to carry into the next one. */
export function manualEntriesOf(document: FormMV1 | null): ManualEntries {
  if (!document) return NO_MANUAL_ENTRIES;
  return {
    contactDetails: document.partI.contactDetails,
    physicalAddress: document.partI.physicalAddress,
    emailAddress: document.partI.emailAddress,
    complaints: document.partII.complaints,
    partIII: document.partIII,
  };
}

export interface AssembleInput {
  fy: number;
  commission: { name: string; issuerCode: string };
  aggregate: Aggregate;
  /** The obligation facts of the listed non-filers, by obligation id. */
  obligations: ReadonlyMap<string, ObligationFactRow>;
  /** Actions on the listed obligations. */
  actions: readonly ActionFactRow[];
  officers: readonly OfficerDetails[];
  /** Clarification statuses by id. */
  clarificationStatuses: ReadonlyMap<string, ClarificationFactStatus>;
  clarifications: readonly ClarificationDetails[];
  /** Remarks a supervisor wrote, by obligation id. */
  remarks: ReadonlyMap<string, string>;
  manual: ManualEntries;
  compiledAt: Date;
}

/**
 * The `form-m.v1` draft. Each non-filer row names the officer (pulled by obligation id), the
 * latest action step taken and whether they complied: `yes` once filed (late), `pending` while an
 * action is out, `no` with no action. Its remark is the supervisor's, else the step's label.
 * Section 4 states each clarification's nature as its requirement labels, never its content.
 */
export function assemble(input: AssembleInput): FormMV1 {
  const officers = new Map(input.officers.map((officer) => [officer.obligationId, officer]));
  const details = new Map(input.clarifications.map((found) => [found.clarificationId, found]));
  const { counts, nonFilers } = input.aggregate;

  const row = (obligationId: string, type: ObligationType): NonFilerRow => {
    const fact = input.obligations.get(obligationId);
    const officer = officers.get(obligationId);
    const actionTaken = latestStep(input.actions, obligationId);
    const complied = fact && filed(fact) ? 'yes' : actionTaken === 'none' ? 'no' : 'pending';
    // The details pull leaves out an obligation declarations no longer knows; the row still
    // counts, dated by the obligation's statement date, for the supervisor to complete.
    const date =
      (type === 'final' ? officer?.exitDate : officer?.appointmentDate) ??
      fact?.statementDate ??
      periodOf(input.fy).from;
    return {
      name: officer?.name ?? '',
      designation: officer?.designation ?? '',
      identifier: officer?.fileNumber ?? '',
      date,
      actionTaken,
      complied,
      remarks: (input.remarks.get(obligationId) ?? ACTION_LABELS[actionTaken]).slice(0, 500),
      obligationId,
    };
  };

  const clarification = (clarificationId: string): ClarificationRow => {
    const found = details.get(clarificationId);
    const status = input.clarificationStatuses.get(clarificationId) ?? 'issued';
    return {
      name: found?.name ?? '',
      designation: found?.designation ?? '',
      identifier: found?.identifier ?? '',
      natureInGeneralTerms: (found?.requirementLabels ?? []).join('; ').slice(0, 300),
      statusOfCompliance: status === 'issued' ? 'pending' : status,
      ...(found?.reference ? { clarificationReference: found.reference } : {}),
    };
  };

  return {
    schemaVersion: 'form-m.v1',
    partI: {
      commissionName: input.commission.name,
      issuerCode: input.commission.issuerCode,
      contactDetails: input.manual.contactDetails,
      physicalAddress: input.manual.physicalAddress,
      emailAddress: input.manual.emailAddress,
      period: periodOf(input.fy),
    },
    partII: {
      initial: {
        ...counts.initial,
        nonFilers: nonFilers.initial.map((id) => row(id, 'initial')),
      },
      biennial: {
        expected: counts.biennial.expected,
        declared: counts.biennial.declared,
        notDeclared: counts.biennial.notDeclared,
        nonFilers: nonFilers.biennial.map((id) => row(id, 'biennial')),
        ...(counts.biennial.noCycleInPeriod ? { noCycleInPeriod: true } : {}),
      },
      final: { ...counts.final, nonFilers: nonFilers.final.map((id) => row(id, 'final')) },
      clarifications: { items: input.aggregate.clarificationIds.map(clarification) },
      accessRequests: {
        ...counts.accessRequests,
        declineReasons: [],
        // Spec 10 projects access requests; until then section 5 is zeros with a note.
        dataUnavailable: true,
      },
      complaints: input.manual.complaints,
    },
    partIII: input.manual.partIII,
    meta: { compiledAt: input.compiledAt.toISOString(), source: 'hosted' },
  };
}

/** The furthest ladder step taken on an obligation, or `none`. */
function latestStep(actions: readonly ActionFactRow[], obligationId: string): ActionStep | 'none' {
  let latest = -1;
  for (const action of actions) {
    if (action.subjectId !== obligationId || !TAKEN.includes(action.status)) continue;
    latest = Math.max(latest, ACTION_STEPS.indexOf(action.step));
  }
  return ACTION_STEPS[latest] ?? 'none';
}
