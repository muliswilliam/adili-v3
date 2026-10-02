import { z } from 'zod';

import {
  NARRATIVE_SECTIONS,
  SECTION_PARAGRAPH_LIMITS,
  narrativeViolations,
} from './narrative-validation.js';
import { defineTask } from './task.js';

/** Named figures; null where a figure is not available (a Commission that did not report). */
const figures = z.record(z.string(), z.number().nullable());

const commissionRow = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .meta({ description: 'Commission slug; names the row in aggregate keys' }),
  commissionName: z.string().meta({
    description: 'A public body, not a person: outside the name fields minimisation tokenises',
  }),
  figures,
});

const year = {
  fy: z.number().int().meta({ description: 'Financial year, by the calendar year it ends in' }),
  totals: figures.meta({ description: 'National counts' }),
  rates: figures.meta({ description: 'National rates, as fractions (0.164 is 16.4%)' }),
  commissionTable: z.array(commissionRow).meta({
    description: 'One row per Commission: code, name and its figures, rates as fractions',
  }),
};

/** Sections whose draft includes findings, each of which must cite a candidate. */
const sectionsWithFindings: ReadonlySet<string> = new Set(['findings', 'all']);

const input = z
  .object({
    kind: z.literal('narrate-compliance-report'),
    ...year,
    priorYears: z.array(z.object(year)),
    candidates: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        subject: z.string().meta({ description: 'Commission slug, entity type, or `national`' }),
        values: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
        aggregateKeys: z.array(z.string()).min(1),
      }),
    ),
    section: z.enum([...NARRATIVE_SECTIONS, 'all']).meta({
      description:
        '`findings` and `all` need at least one candidate: a finding narrates a computed pattern, so with none no draft could pass validation',
    }),
    language: z.enum(['en']),
  })
  // Refused here, before a provider is paid for a draft that must fail.
  .refine((each) => each.candidates.length > 0 || !sectionsWithFindings.has(each.section), {
    path: ['candidates'],
    message: 'A draft of `findings` or `all` needs at least one candidate',
  })
  .meta({
    description:
      'Aggregate keys name each figure: `national.<name>` for totals and rates, `commission.<code>.<name>` for a Commission row, and the same prefixed `fy<fy>.` for a prior year (`fy2025.national.filed`)',
  });

const output = z.object({
  paragraphs: z
    .array(
      z.object({
        section: z.enum(NARRATIVE_SECTIONS),
        text: z.string().max(2000),
        aggregateRefs: z.array(z.string()).min(1),
        candidateIds: z.array(z.string()),
      }),
    )
    .max(
      SECTION_PARAGRAPH_LIMITS.overview +
        SECTION_PARAGRAPH_LIMITS.findings +
        SECTION_PARAGRAPH_LIMITS.recommendations,
    )
    .meta({
      description:
        'The job fails with reason `validation` unless every number in the text is in the input (separators stripped; a percentage is a rate ×100 rounded half up to the places written, at most two; years only as input FYs), every aggregate ref and candidate id is in the input, every finding narrates a candidate, and the paragraphs cover exactly the sections asked for (overview at most 3, findings 12, recommendations 6)',
    }),
});

export type NarrateInput = z.infer<typeof input>;
export type NarrateOutput = z.infer<typeof output>;

/** Narrative for the National Consolidated Report, drawn only from aggregates (spec 09b). */
export const narrateComplianceReport = defineTask({
  name: 'narrate-compliance-report',
  input,
  output,
  promptVersions: [1],
  maxOutputTokens: 8192,
  validate: narrativeViolations,
});
