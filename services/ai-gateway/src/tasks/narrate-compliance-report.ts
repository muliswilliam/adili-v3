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
  name: z.string(),
  figures,
});

const year = {
  fy: z.number().int().meta({ description: 'Financial year, by the calendar year it ends in' }),
  totals: figures.meta({ description: 'National counts' }),
  rates: figures.meta({ description: 'National rates, as fractions (0.123 is 12.3%)' }),
  commissionTable: z.array(commissionRow).meta({
    description: 'One row per Commission: code, name and its figures, rates as fractions',
  }),
};

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
    section: z.enum([...NARRATIVE_SECTIONS, 'all']),
    language: z.enum(['en']),
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
    ),
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
