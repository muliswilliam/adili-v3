import { z } from 'zod';

/** Types shared by the task contracts (ai-gateway.yaml components). */

export const LANGUAGES = ['en', 'sw'] as const;
export const language = z.enum(LANGUAGES);
export type Language = z.infer<typeof language>;

/** A pointer into the declaration the UI turns into a link; unknown parts are null. */
export const sourceRef = z.object({
  sectionKey: z.string().nullable(),
  personKey: z.string().nullable(),
  itemId: z.uuid().nullable(),
  fieldPath: z
    .string()
    .nullable()
    .meta({ description: 'JSON pointer into the declaration.v1 document' }),
});

export const flagInput = z.object({
  id: z.uuid(),
  ruleId: z.string(),
  severity: z.string(),
  title: z.string(),
  indicator: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  itemRefs: z.array(sourceRef),
});

export const changeInput = z.object({
  kind: z.enum(['acquired', 'disposed', 'value-changed', 'unchanged', 'corrected']),
  personKey: z.string(),
  sectionKey: z.string(),
  itemId: z.uuid().nullable(),
  percent: z.number().nullable(),
});

export const registryStatusInput = z.object({
  system: z.string(),
  status: z.string(),
});

/** Free-form JSON object (declaration documents, item context, flag evidence). */
export const jsonObject = z.record(z.string(), z.unknown());

export const CLARIFICATION_REQUIREMENTS = [
  'provide-omitted',
  'explain-discrepancy',
  'correct',
] as const;
