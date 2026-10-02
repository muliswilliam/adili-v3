import { z } from 'zod';

import {
  clarificationSchema,
  clarificationStatusSchema,
} from '../clarifications/representation.js';
import { determinationSchema } from '../determinations/representation.js';
import {
  type Evidence,
  type ItemRef,
  REGISTRY_CHECK_STATUSES,
  REGISTRY_SYSTEMS,
  RULES,
  type RuleId,
  SEVERITIES,
} from '../rules/index.js';
import { type Assignee, assigneeSchema } from './assignee.js';
import {
  CASE_STATUSES,
  type ClarificationStatus,
  DECLARATION_TYPES,
  FLAG_CLOSED_REASONS,
  PRIORITY_BANDS,
  type reviewCases,
  type reviewFlags,
} from './schema.js';

export { type Assignee, assigneeSchema, officer } from './assignee.js';
export type { ClarificationView } from '../clarifications/representation.js';

/**
 * Bodies of the queue and case API (spec 07a, 07b). They are the contract: the OpenAPI document,
 * packages/schemas/internal/review.yaml, is generated from them (`pnpm contracts`).
 */

export const declarationTypeSchema = z.enum(DECLARATION_TYPES);
export const caseStatusSchema = z.enum(CASE_STATUSES);
export const priorityBandSchema = z.enum(PRIORITY_BANDS);
export const severitySchema = z.enum(SEVERITIES);
export const ruleIdSchema = z.enum(Object.keys(RULES) as [RuleId, ...RuleId[]]);
export const registrySystemSchema = z.enum(REGISTRY_SYSTEMS);
export const registryCheckStatusSchema = z.enum(REGISTRY_CHECK_STATUSES);

/** review.yaml `CaseListItem`: a row of the queue. */
export const caseListItemSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  declarantName: z.string(),
  personnelFileNumber: z.string(),
  type: declarationTypeSchema,
  cycleYear: z.int(),
  receivedAt: z.iso.datetime(),
  windowEndsAt: z.iso.datetime(),
  late: z.boolean(),
  band: priorityBandSchema,
  status: caseStatusSchema,
  assignee: assigneeSchema.nullable(),
  openFlags: z.int(),
  registryUnavailable: z.boolean().meta({
    description:
      "A registry could not be checked for someone on the case at its latest registry check (the queue's icon)",
  }),
  clarification: z.object({
    open: z.int().meta({ description: 'Clarifications the declarant still has to answer' }),
    status: clarificationStatusSchema
      .nullable()
      .meta({ description: 'The status of the latest clarification issued; null when none was' }),
    dueAt: z.iso.datetime().nullable(),
  }),
  currentVersion: z.int(),
});
export type CaseListItem = z.infer<typeof caseListItemSchema>;

export interface CasePage {
  items: CaseListItem[];
  nextCursor: string | null;
}

/** Cases per priority band. */
const bandCountsSchema = z.object({ low: z.int(), medium: z.int(), high: z.int() });

/** review.yaml `QueueSummary`. */
export const queueSummarySchema = z.object({
  byStatus: z.record(z.string(), z.int()),
  byBand: z.record(z.string(), z.int()),
  byStatusAndBand: z.record(z.string(), bandCountsSchema).meta({
    description: "Every status with its cases per band (the queue's tiles break their counts down)",
  }),
  mine: bandCountsSchema.meta({
    description: 'Cases the caller holds that are not determined, per band',
  }),
  overdueClarifications: z.int(),
});
export type QueueSummary = z.infer<typeof queueSummarySchema>;

/** review.yaml `ReviewerList`: whom a supervisor can give a case to. */
export const reviewerListSchema = z.object({
  items: z.array(
    z.object({
      subject: z.string().meta({ description: "The staff member's account (token `sub`)" }),
      name: z.string(),
      supervisor: z.boolean().meta({ description: 'Holds the supervisor role' }),
      openCases: z.int().meta({ description: 'Cases of the Commission they hold, not determined' }),
    }),
  ),
});
export type ReviewerList = z.infer<typeof reviewerListSchema>;

/** Clear facts only (rules' `Evidence`): percentages, counts, dates, references. */
const evidenceSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))
  .meta({
    description:
      'Clear facts only (percentages, counts, dates, references); no amounts or descriptions',
  }) satisfies z.ZodType<Evidence>;

const itemRefSchema = z.object({
  personKey: z.string(),
  itemId: z.uuid().nullable().meta({
    description: 'The item concerned, or null when the flag is about a whole category or statement',
  }),
  sectionKey: z.string().nullable(),
}) satisfies z.ZodType<ItemRef>;

/** review.yaml `Flag`. */
export const flagSchema = z.object({
  id: z.uuid(),
  versionId: z.uuid(),
  ruleId: ruleIdSchema,
  severity: severitySchema,
  title: z.string(),
  indicator: z.string().meta({ description: 'Plain-language indicator text; never a finding' }),
  evidence: evidenceSchema,
  itemRefs: z.array(itemRefSchema),
  closedReason: z.enum(FLAG_CLOSED_REASONS).nullable().meta({
    description:
      'Why the flag no longer counts toward the score and the open flags: a registry re-check no longer raised it. A reviewed flag keeps its note. Null while it counts.',
  }),
  reviewed: z.object({ at: z.iso.datetime(), by: assigneeSchema, note: z.string() }).nullable(),
  recomputed: z.boolean(),
});
export type FlagView = z.infer<typeof flagSchema>;

/** review.yaml `Note`. */
export const noteSchema = z.object({
  id: z.uuid(),
  author: assigneeSchema,
  text: z.string(),
  at: z.iso.datetime(),
});
export type NoteView = z.infer<typeof noteSchema>;

/** review.yaml `TimelineEntry`; the actor is null for the service's own work. */
export const timelineEntrySchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  actor: assigneeSchema.nullable(),
  at: z.iso.datetime(),
  summary: z.string(),
  ref: z.string().nullable(),
});
export type TimelineEntryView = z.infer<typeof timelineEntrySchema>;

/** review.yaml `RegistryCheck`: one person's status in one registry at the latest check. */
export const registryCheckSchema = z
  .object({
    personKey: z.string(),
    system: registrySystemSchema,
    status: registryCheckStatusSchema,
    reason: z.string().nullable().meta({
      description:
        "Why the registry is unavailable: the gateway's reason (timeout, breaker-open, paused, rate-limited, upstream-error), gateway-unavailable or gateway-rejected when the gateway gave no answer, supplier-check-unavailable when BRS answered but the employer supplier check did not, result-missing when the stored result could not be read back",
    }),
    checkedAt: z.iso.datetime(),
    resultId: z.uuid().nullable().meta({
      description:
        "The integration-gateway's stored result, from which the Registry tab pulls the records",
    }),
  })
  .meta({
    description: "One person's status in one registry at the case's latest registry check",
  });
export type RegistryCheckView = z.infer<typeof registryCheckSchema>;

/**
 * review.yaml `RegistrySummary`: the statuses of the latest registry check, per person and
 * registry; none before the first check (every registry `not-checked`).
 */
export const registrySummarySchema = z
  .object({
    checkedAt: z.iso.datetime().nullable(),
    checks: z.array(registryCheckSchema),
    recheckAvailableAt: z.iso.datetime().nullable().meta({
      description:
        'When the next manual re-check is accepted: 10 minutes after the last one asked for, which a re-check before then is refused with 429 `recheck-cooldown`; null before the first. A time in the past means one is accepted now',
    }),
  })
  .meta({
    description:
      "The case's latest registry check, per person with an entry per registry; empty with checkedAt null before the first check (every registry not checked)",
  });
export type RegistrySummary = z.infer<typeof registrySummarySchema>;

/** review.yaml `CaseDetail`; `document` is null when declarations could not be read. */
export const caseDetailSchema = z.object({
  case: caseListItemSchema,
  flags: z.array(flagSchema),
  clarifications: z.array(clarificationSchema),
  notes: z.array(noteSchema),
  timeline: z.array(timelineEntrySchema),
  document: z.record(z.string(), z.unknown()).nullable().meta({
    description:
      "The current version's declaration.v1 document, pulled from the declarations service (null when unavailable)",
  }),
  versions: z
    .array(
      z.object({
        versionId: z.uuid(),
        version: z.int(),
        submittedAt: z.iso.datetime(),
        late: z.boolean(),
        amendment: z
          .boolean()
          .meta({ description: 'The version amended an earlier one of the same declaration' }),
        firstOnAdili: z.boolean().meta({
          description:
            'The rules found no earlier declaration on Adili to compare the version with (`no-previous-version`), kept after an amendment replaces that flag',
        }),
      }),
    )
    .meta({
      description:
        "Every version the case has processed, from the review service's own records; only the current one's document is pulled",
    }),
  reviewerHistory: z.array(assigneeSchema),
  determinations: z.array(determinationSchema).meta({
    description: 'Every determination of the case, oldest first; the current one is last',
  }),
  registry: registrySummarySchema,
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

/** A short-lived link to an attachment of the declaration under review. */
export const attachmentDownloadSchema = z.object({
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
export type AttachmentDownload = z.infer<typeof attachmentDownloadSchema>;

type CaseRow = typeof reviewCases.$inferSelect;

/** The latest clarification issued on a case, for its queue row. */
export interface LatestClarification {
  status: ClarificationStatus;
  dueAt: Date | null;
}

/** A case row as the queue and the case actions show it. */
export function caseListItem(row: CaseRow, latest: LatestClarification | undefined): CaseListItem {
  return {
    id: row.id,
    reference: row.reference,
    declarantName: row.declarantName,
    personnelFileNumber: row.personnelFileNumber,
    type: row.type,
    cycleYear: row.cycleYear,
    receivedAt: row.receivedAt.toISOString(),
    windowEndsAt: row.windowEndsAt.toISOString(),
    late: row.late,
    band: row.band,
    status: row.status,
    assignee:
      row.assignee === null
        ? null
        : { subject: row.assignee, name: row.assigneeName ?? row.assignee },
    openFlags: row.openFlags,
    registryUnavailable: row.registryUnavailable,
    clarification: {
      open: row.openClarifications,
      status: latest?.status ?? null,
      dueAt: latest?.dueAt?.toISOString() ?? null,
    },
    currentVersion: row.currentVersion,
  };
}

/** A flag row as the case view shows it; `officer` names the reviewer. */
export function flagView(
  flag: typeof reviewFlags.$inferSelect,
  officer: (subject: string) => Assignee,
): FlagView {
  return {
    id: flag.id,
    versionId: flag.versionId,
    ruleId: flag.ruleId,
    severity: flag.severity,
    title: flag.title,
    indicator: flag.indicator,
    evidence: flag.evidence,
    itemRefs: flag.itemRefs,
    closedReason: flag.closedReason,
    reviewed:
      flag.reviewedAt === null || flag.reviewedBy === null
        ? null
        : {
            at: flag.reviewedAt.toISOString(),
            by: officer(flag.reviewedBy),
            note: flag.reviewNote ?? '',
          },
    recomputed: flag.recomputed,
  };
}
