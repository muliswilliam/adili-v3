import { z } from 'zod';

import {
  CLARIFICATION_REQUIREMENTS,
  flagInput,
  jsonObject,
  language,
  sourceRef,
} from './common.js';
import { defineTask } from './task.js';

/** Draft clarification items (s.35) for a reviewer to edit and issue; the gateway issues nothing. */
export const draftClarification = defineTask({
  name: 'draft-clarification',
  input: z.object({
    kind: z.literal('draft-clarification'),
    commissionName: z.string(),
    language,
    selections: z
      .array(
        z.object({
          ref: sourceRef,
          flag: flagInput.nullable(),
          itemContext: jsonObject,
          requirement: z.enum(CLARIFICATION_REQUIREMENTS).nullable().meta({
            description: "Reviewer's choice if set; the task proposes one otherwise",
          }),
        }),
      )
      .min(1)
      .max(50),
  }),
  output: z.object({
    opening: z.string().max(800).nullable(),
    items: z
      .array(
        z.object({
          ref: sourceRef,
          requirement: z.enum(CLARIFICATION_REQUIREMENTS),
          text: z.string().min(1).max(1000),
        }),
      )
      .min(1),
  }),
  promptVersions: [1],
  maxOutputTokens: 4096,
  // Drafts are stored briefly (spec 07c): the reviewer inserts them into the composer or not.
  outputRetentionHours: 24,
});
