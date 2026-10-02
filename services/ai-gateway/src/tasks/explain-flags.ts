import { z } from 'zod';

import { flagInput, jsonObject, language, sourceRef } from './common.js';
import { defineTask } from './task.js';

/** Plain-language explanations of deterministic risk flags: meaning, checks, resolution. */
export const explainFlags = defineTask({
  name: 'explain-flags',
  input: z.object({
    kind: z.literal('explain-flags'),
    flags: z.array(flagInput).min(1),
    itemContext: z.array(z.object({ ref: sourceRef, context: jsonObject })).meta({
      description:
        'Minimal context for referenced items (type, description, values); personal identifiers are replaced with tokens before any provider call',
    }),
    language,
  }),
  output: z.object({
    explanations: z.array(
      z.object({
        flagId: z.uuid(),
        meaning: z.string().max(500),
        whatToCheck: z.array(z.string().max(200)).min(1),
        typicalResolution: z.string().max(300),
        refs: z.array(sourceRef),
      }),
    ),
  }),
  promptVersions: [1],
  maxOutputTokens: 4096,
});
