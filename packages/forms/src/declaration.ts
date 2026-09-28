import schema from '@adili/schemas/forms/declaration.v1.json' with { type: 'json' };

import type { z } from 'zod';

import type { DeclarationV1 } from './declaration.v1.gen.js';
import { DeclarationSchema, StatementSchema } from './declaration.v1.zod.gen.js';
import { compileForm, type FormValidationError } from './validate.js';

/** Validates a declaration (the First Schedule, paragraphs 1-9) against `declaration.v1`. */
export const validateDeclaration = compileForm<DeclarationV1>(schema);

/** `officer` or `spouse:<id>` / `child:<id>`: whose financial statement (paragraph 8) it is. */
export type PersonKey = 'officer' | `spouse:${string}` | `child:${string}`;

/**
 * A capture section of a draft (declarations.yaml `SectionKey`): `bio` holds `officer`,
 * `household` holds `{ spouses, children }`, `statement:<personKey>` one `statements[]` entry and
 * `other` holds `otherInformation`.
 */
export type DeclarationSectionKey = 'bio' | 'household' | 'other' | `statement:${PersonKey}`;

/** A schema problem placed on the section that shows it, for completeness messages. */
export interface DeclarationIssue {
  /** The section, or null for the declaration's own fields (type, dates, attestation). */
  sectionKey: DeclarationSectionKey | null;
  /** Dotted path within the section's contents; the whole path when `sectionKey` is null. */
  path: string;
  message: string;
}

const PERSON_KEY = new RegExp(schema.$defs.PersonKey.pattern);

/** Validates a declaration and places every problem on its section and field. */
export function declarationIssues(document: unknown): DeclarationIssue[] {
  const result = validateDeclaration(document);
  return result.ok ? [] : result.errors.map((error) => toIssue(error, document));
}

function toIssue({ path, message }: FormValidationError, document: unknown): DeclarationIssue {
  const [head, ...rest] = path.split('.');
  switch (head) {
    case 'officer':
      return { sectionKey: 'bio', path: rest.join('.'), message };
    case 'spouses':
    case 'children':
      return { sectionKey: 'household', path, message };
    case 'otherInformation':
      return { sectionKey: 'other', path: rest.join('.'), message };
    case 'statements': {
      const [index, ...field] = rest;
      const personKey = statementPersonKey(document, Number(index));
      if (index !== undefined && personKey !== undefined) {
        return { sectionKey: `statement:${personKey}`, path: field.join('.'), message };
      }
      return { sectionKey: null, path, message };
    }
    default:
      return { sectionKey: null, path, message };
  }
}

const SECTION_SCHEMAS = {
  bio: DeclarationSchema.shape.officer,
  household: DeclarationSchema.pick({ spouses: true, children: true }),
  statement: StatementSchema,
  other: DeclarationSchema.shape.otherInformation,
};

/**
 * The Zod schema of a section's contents, generated from `declaration.v1` like the whole-form
 * validator, for the portal's forms and the service's section saves.
 */
export function sectionSchema(key: DeclarationSectionKey): z.ZodType {
  return key.startsWith('statement:') ? SECTION_SCHEMAS.statement : SECTION_SCHEMAS[key as 'bio'];
}

/** A declaration split into its capture sections, in capture order, one statement per person. */
export function sectionContents(document: DeclarationV1): [DeclarationSectionKey, unknown][] {
  return [
    ['bio', document.officer],
    ['household', { spouses: document.spouses, children: document.children }],
    ...document.statements.map((statement): [DeclarationSectionKey, unknown] => [
      `statement:${statement.personKey as PersonKey}`,
      statement,
    ]),
    ['other', document.otherInformation],
  ];
}

function statementPersonKey(document: unknown, index: number): PersonKey | undefined {
  const statements = (document as { statements?: unknown } | null)?.statements;
  if (!Array.isArray(statements)) return undefined;
  const personKey = (statements[index] as { personKey?: unknown } | undefined)?.personKey;
  return typeof personKey === 'string' && PERSON_KEY.test(personKey)
    ? (personKey as PersonKey)
    : undefined;
}
