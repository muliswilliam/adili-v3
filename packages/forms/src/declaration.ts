import schema from '@adili/schemas/forms/declaration.v1.json' with { type: 'json' };
import type { z } from 'zod';

import type { DeclarationV1 } from './declaration.v1.gen.js';
import { DeclarationSchema, StatementSchema } from './declaration.v1.zod.gen.js';
import {
  compileFieldProblems,
  type FieldProblem,
  formValidator,
  type FormValidationError,
  jsonPointer,
} from './validate.js';

const declarationProblems = compileFieldProblems(schema);

/** Validates a declaration (the First Schedule, paragraphs 1-9) against `declaration.v1`. */
export const validateDeclaration = formValidator<DeclarationV1>(declarationProblems);

/** `officer` or `spouse:<id>` / `child:<id>`: whose financial statement (paragraph 8) it is. */
export type PersonKey = 'officer' | `spouse:${string}` | `child:${string}`;

/**
 * A capture section of a draft (declarations.yaml `SectionKey`): `bio` holds `officer`,
 * `household` holds `{ spouses, children }`, `statement:<personKey>` holds one person's
 * financial statement and `other` holds `otherInformation`. A test holds these to the contract.
 */
export type DeclarationSectionKey = 'bio' | 'household' | 'other' | `statement:${PersonKey}`;

/** A schema problem on a capture section, as declarations.yaml `CompletenessIssue`. */
export interface DeclarationIssue {
  sectionKey: DeclarationSectionKey;
  /** JSON pointer within the capture section's contents, e.g. `/birth/date`. */
  path: string;
  /** The JSON Schema keyword that failed, e.g. `required`, `pattern` or `minItems`. */
  code: string;
  message: string;
}

export interface DeclarationProblems {
  /** Problems the declarant can fix, each on the capture section that shows it. */
  issues: DeclarationIssue[];
  /**
   * Problems with what the service fills in (type, dates, the statements' person keys, the
   * attestation). They are not the declarant's to fix, so no capture section shows them.
   */
  declaration: FormValidationError[];
}

const FIXED_SECTION_KEYS = ['bio', 'household', 'other'] as const;
type FixedSectionKey = (typeof FIXED_SECTION_KEYS)[number];
type Fields = readonly [keyof DeclarationV1, ...(keyof DeclarationV1)[]];

/**
 * The capture sections other than the per-person statements: the declaration.v1 fields each
 * holds, and whether paths inside it keep the field name (household contents are
 * `{ spouses, children }`, so they do; bio and other contents are the field itself).
 */
const FIXED_SECTIONS: Record<
  FixedSectionKey,
  { fields: Fields; keepsFieldName: boolean; schema: z.ZodType }
> = {
  bio: { fields: ['officer'], keepsFieldName: false, schema: DeclarationSchema.shape.officer },
  household: {
    fields: ['spouses', 'children'],
    keepsFieldName: true,
    schema: DeclarationSchema.pick({ spouses: true, children: true }),
  },
  other: {
    fields: ['otherInformation'],
    keepsFieldName: false,
    schema: DeclarationSchema.shape.otherInformation,
  },
};

const PERSON_KEY = new RegExp(schema.$defs.PersonKey.pattern, 'u');

function isStatementKey(key: DeclarationSectionKey): key is `statement:${PersonKey}` {
  return key.startsWith('statement:');
}

/**
 * The Zod schema of a capture section's contents, generated from `declaration.v1` like the
 * whole-form validator, for the portal's forms and the service's capture section saves.
 *
 * Zod runs a refinement (a flagged change needs a kind and an explanation, a joint asset a share)
 * only once the rest of its object parses, so while a field is malformed it reports fewer
 * problems than `declarationIssues`. Completeness comes from `declarationIssues`.
 */
export function sectionSchema(key: DeclarationSectionKey): z.ZodType {
  return isStatementKey(key) ? StatementSchema : FIXED_SECTIONS[key].schema;
}

/** A declaration split into its capture sections, in capture order, one statement per person. */
export function sectionContents(document: DeclarationV1): [DeclarationSectionKey, unknown][] {
  const fixed = (key: FixedSectionKey): [DeclarationSectionKey, unknown] => {
    const { fields, keepsFieldName } = FIXED_SECTIONS[key];
    return [
      key,
      keepsFieldName
        ? Object.fromEntries(fields.map((field) => [field, document[field]]))
        : document[fields[0]],
    ];
  };
  return [
    fixed('bio'),
    fixed('household'),
    ...document.statements.map((statement): [DeclarationSectionKey, unknown] => [
      `statement:${statement.personKey as PersonKey}`,
      statement,
    ]),
    fixed('other'),
  ];
}

/** Validates a declaration and places every problem on its capture section and field. */
export function declarationIssues(document: unknown): DeclarationProblems {
  const found: DeclarationProblems = { issues: [], declaration: [] };
  for (const problem of declarationProblems(document)) {
    // A failed if/then/else is also reported on the field it requires; that report is enough.
    if (problem.code === 'if') continue;
    const issue = toIssue(problem, document);
    if (issue) found.issues.push(issue);
    else found.declaration.push({ path: problem.segments.join('.'), message: problem.message });
  }
  return found;
}

function toIssue({ segments, code, message }: FieldProblem, document: unknown) {
  const [head, ...rest] = segments;
  const at = (sectionKey: DeclarationSectionKey, inside: string[]): DeclarationIssue => ({
    sectionKey,
    path: jsonPointer(inside),
    code,
    message,
  });
  if (head === 'statements') {
    const [index, ...field] = rest;
    const personKey = statementPersonKey(document, Number(index));
    return index !== undefined && personKey ? at(`statement:${personKey}`, field) : undefined;
  }
  for (const key of FIXED_SECTION_KEYS) {
    const { fields, keepsFieldName } = FIXED_SECTIONS[key];
    if (fields.some((field) => field === head)) return at(key, keepsFieldName ? segments : rest);
  }
  return undefined;
}

function statementPersonKey(document: unknown, index: number): PersonKey | undefined {
  const statements = (document as { statements?: unknown } | null)?.statements;
  if (!Array.isArray(statements)) return undefined;
  const personKey = (statements[index] as { personKey?: unknown } | undefined)?.personKey;
  return typeof personKey === 'string' && PERSON_KEY.test(personKey)
    ? (personKey as PersonKey)
    : undefined;
}
