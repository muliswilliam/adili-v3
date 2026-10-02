import { z } from 'zod';

import {
  changeInput,
  flagInput,
  jsonObject,
  language,
  registryStatusInput,
  sourceRef,
} from './common.js';
import { defineTask } from './task.js';

/** A reviewer summary of a declaration that cites the fields and changes it draws on. */
export const summarizeDeclaration = defineTask({
  name: 'summarize-declaration',
  input: z.object({
    kind: z.literal('summarize-declaration'),
    document: jsonObject.meta({
      description:
        'declaration.v1 document. The gateway replaces personal identifiers with tokens before any provider call and restores them in the output',
    }),
    previousDocument: jsonObject.nullable(),
    changes: z.array(changeInput),
    flags: z.array(flagInput),
    registryStatuses: z.array(registryStatusInput),
    language,
  }),
  output: z.object({
    overview: z.string().max(1200),
    changesSincePrevious: z.array(
      z.object({ text: z.string().max(300), refs: z.array(sourceRef).min(1) }),
    ),
    sections: z.array(
      z.object({ sectionKey: z.string(), text: z.string().max(600), refs: z.array(sourceRef) }),
    ),
    worthAttention: z.array(z.object({ text: z.string().max(300), flagIds: z.array(z.uuid()) })),
  }),
  promptVersions: [1],
  // A household declaration (several statements, refs with ids) needs more than 4096 tokens.
  maxOutputTokens: 8192,
});
