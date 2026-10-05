import { z } from 'zod';

import { DOCUMENT_CONTENT_TYPES, type ReadDocument } from '../documents/read-document.js';
import { holdsAccountNumber } from '../policy/minimisation.js';
import { language } from './common.js';
import { type ItemTarget, itemFields, itemTarget } from './item-fields.js';
import { defineTask, type OutputViolation } from './task.js';

/** What the declarant says the document is (declarations.yaml `extractAttachment`). */
export const DOCUMENT_KINDS = [
  'title-deed',
  'logbook',
  'payslip',
  'bank-letter',
  'share-certificate',
  'other',
] as const;

const confidence = z
  .number()
  .min(0)
  .max(1)
  .meta({ description: 'How sure the reading is: 1 printed and clear, below 0.5 a guess' });
const page = z
  .int()
  .min(1)
  .nullable()
  .meta({ description: 'The page the value is on; null when it is on none (worked out)' });

/** One field the document fills: its path in the item, the value, how sure, and where. */
const extractedField = z.object({
  name: z.string().meta({ description: 'Field path within the target item type' }),
  value: z.union([z.string(), z.number(), z.boolean()]).meta({
    description: 'Typed as declaration.v1 types the field: text, a number or a boolean',
  }),
  confidence,
  page,
});

const warnings = z.array(z.string().max(300)).max(10).meta({
  description:
    "What the declarant should know about the reading (an unreadable page, a document that is not the item's), in the request's language",
});

const output = z.object({
  detectedKind: z.enum(DOCUMENT_KINDS),
  fields: z.array(extractedField).max(30),
  warnings,
});

/** The output for one target item type: its fields only, each typed (built once per target). */
const outputs = new Map<string, typeof output>();
function outputFor(target: ItemTarget): typeof output {
  const key = `${target.section}/${target.itemType}`;
  let schema = outputs.get(key);
  if (!schema) {
    const [first, ...rest] = itemFields(target).map(({ name, value }) =>
      z.object({ name: z.literal(name), value, confidence, page }),
    );
    if (!first) throw new Error(`No fields for ${key}`);
    schema = output.extend({
      fields: z.array(z.discriminatedUnion('name', [first, ...rest])).max(30),
    }) as unknown as typeof output;
    outputs.set(key, schema);
  }
  return schema;
}

const input = z.object({
  kind: z.literal('extract-document'),
  documentKindHint: z.enum(DOCUMENT_KINDS),
  target: itemTarget.meta({
    description:
      'The declaration.v1 statement item the fields must fit: its section and Second Schedule item type',
  }),
  attachment: z.object({
    downloadUrl: z.url({ protocol: /^https?$/u }).meta({
      description:
        'Short-lived internal URL from the documents service; the gateway fetches it, and never sends it to a provider',
    }),
    contentType: z.enum(DOCUMENT_CONTENT_TYPES),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .meta({ description: 'The file must hash to it; with the rest of the input, the cache key' }),
  }),
  language,
});
export type ExtractInput = z.infer<typeof input>;
export type ExtractOutput = z.infer<typeof output>;

/** A reading fails when it names a field twice or holds an account number anywhere. */
function validate(_input: ExtractInput, { fields }: ExtractOutput): OutputViolation[] {
  const seen = new Set<string>();
  return fields.flatMap((field, index): OutputViolation[] => {
    if (seen.has(field.name)) return [{ kind: 'duplicate-field', field: index }];
    seen.add(field.name);
    // declaration.v1 holds no account number.
    if (typeof field.value === 'string' && holdsAccountNumber(field.value)) {
      return [{ kind: 'account-number', field: index }];
    }
    return [];
  });
}

/** What the model reads: the request less the link, and the document's pages. */
function modelInput(request: ExtractInput, document: ReadDocument | undefined) {
  return {
    kind: request.kind,
    documentKindHint: request.documentKindHint,
    target: request.target,
    language: request.language,
    document: {
      pageCount: document?.pageCount ?? 0,
      pages: document?.pages ?? [],
    },
  };
}

/**
 * Reads a title deed, logbook, payslip, bank letter or share certificate into the fields of one
 * statement item, with a confidence and page per field (spec 05b, ADR-007). The declarant reviews
 * every field before anything enters the declaration.
 */
export const extractDocument = defineTask({
  name: 'extract-document',
  input,
  output,
  outputFor: (request) => outputFor(request.target),
  identity: (request) => ({
    ...request,
    attachment: { contentType: request.attachment.contentType, sha256: request.attachment.sha256 },
  }),
  document: (request) => request.attachment,
  modelInput,
  validate,
  promptVersions: [1],
  maxOutputTokens: 4096,
  // A document image holds names, ID numbers and property in one artefact: nothing minimises it.
  dataClass: 'highly-confidential',
  disclaimer: {
    en: 'AI-assisted. Read from your document: check every field before you use it.',
    sw: 'Imesaidiwa na AI. Imesomwa kutoka kwa hati yako: kagua kila sehemu kabla ya kuitumia.',
  },
});
