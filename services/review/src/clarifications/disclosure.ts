import { FORM_K_SECTIONS, type FormKSection } from '@adili/forms';
import {
  GRANT_LEGAL_BASES,
  GRANT_REFERENCE_PATTERN,
  grantLegalBasis,
  type GrantLegalBasis,
  isGrantReference,
} from '@adili/numbering/references';
import { z } from 'zod';

import type {
  ClarificationItem,
  ClarificationLetter,
  ClarificationResponseAttachment,
  ClarificationResponseItem,
  LetterLanguage,
} from '../cases/schema.js';
import { itemLabel, REQUIREMENT_LABELS } from './labels.js';

/**
 * What an access grant discloses of a declarant's clarifications (spec 10, Act s.36(1),
 * Regulation 22(1)): the clarifications issued on the declarations a grant disclosed, as their
 * letters put each item and as the declarant answered it, cut to the grant's household members
 * and sections. Pure, so the cut is tested apart from the read around it.
 *
 * An item goes out only when everything it can concern is granted, because its text and answer
 * are free text about that part of the declaration:
 * - an item about a spouse or a child needs that household member included;
 * - `bio` needs `bio`; `household` (spouses' and children's particulars) needs `bio` with both
 *   spouses and children; `other` needs `other`;
 * - an item on a financial statement (`statement:<person>`, or a person or entry of one) needs
 *   `income`, `assets` and `liabilities`, as an item does not record which of them it concerns;
 * - an item on the declaration as a whole needs every section and both household members.
 * A clarification left with no item is not disclosed. The reviewer's resolution note is the
 * Commission's assessment, not part of the clarification, and never goes out.
 */

/** The sections of an access scope (access.yaml `Section`, declarations' `DisclosureSection`). */
export const DISCLOSURE_SECTIONS = FORM_K_SECTIONS;
export type DisclosureSection = FormKSection;

const FINANCIAL_SECTIONS = ['income', 'assets', 'liabilities'] as const;

/** The provisions a grant rests on: Act s.36(1) (Form K, `ARQ`), s.36(2) (law enforcement, `LEA`). */
export type LegalBasis = GrantLegalBasis;

/** The statuses of a clarification an access grant can disclose: issued, never a draft or withdrawn. */
export const DISCLOSED_STATUSES = ['issued', 'overdue', 'responded', 'resolved'] as const;
export type DisclosedStatus = (typeof DISCLOSED_STATUSES)[number];

/** The most declarations one disclosure names: a grant's versions, at most 50 years of them. */
const MAX_DECLARATIONS = 200;

const grantScopeFields = {
  personId: z.uuid(),
  grantReference: z
    .string()
    .regex(GRANT_REFERENCE_PATTERN)
    .refine(isGrantReference, { message: 'not a valid ARQ or LEA reference (check character)' }),
  legalBasis: z.enum(GRANT_LEGAL_BASES),
  declarationReferences: z.array(z.string().min(1).max(64)).min(1).max(MAX_DECLARATIONS),
  includeSpouses: z.boolean(),
  includeChildren: z.boolean(),
  sections: z.array(z.enum(DISCLOSURE_SECTIONS)).min(1).max(DISCLOSURE_SECTIONS.length),
};

const LEGAL_BASIS_OF_REFERENCE = {
  path: ['legalBasis'],
  message: 'act-s36-1 goes with an ARQ reference, act-s36-2 with an LEA reference',
};

export const clarificationDisclosureRequest = z
  .strictObject({ ...grantScopeFields, recipientSubject: z.string().min(1).max(255) })
  .refine(
    (request) => grantLegalBasis(request.grantReference) === request.legalBasis,
    LEGAL_BASIS_OF_REFERENCE,
  );
export type ClarificationDisclosureRequest = z.infer<typeof clarificationDisclosureRequest>;

/**
 * A scope the access officer is weighing before deciding (decision 1), to be counted: the
 * disclosure's request without a recipient, as the officer asking is the one who sees the counts.
 */
export const clarificationCountsRequest = z
  .strictObject(grantScopeFields)
  .refine(
    (request) => grantLegalBasis(request.grantReference) === request.legalBasis,
    LEGAL_BASIS_OF_REFERENCE,
  );
export type ClarificationCountsRequest = z.infer<typeof clarificationCountsRequest>;

/** Per declaration named, the clarifications a grant of the scope would disclose. */
export const clarificationCountsSchema = z.object({
  counts: z
    .array(
      z.object({
        declarationReference: z.string(),
        clarifications: z.int().min(0),
      }),
    )
    .meta({ description: 'One per declaration named, in the order named' }),
});
export type ClarificationCounts = z.infer<typeof clarificationCountsSchema>;

/** The household members and sections a grant allows. */
export type DisclosureScope = Pick<
  ClarificationDisclosureRequest,
  'includeSpouses' | 'includeChildren' | 'sections'
>;

/** One item as its letter put it, and its answer. */
export const disclosedClarificationItemSchema = z.object({
  label: z.string().meta({ description: 'What the item concerns, as the letter put it' }),
  requirementLabel: z.string().meta({ description: 'What Act s.35(4) required of the declarant' }),
  text: z.string().meta({ description: "The reviewer's request" }),
  response: z
    .object({
      text: z.string(),
      attachmentNames: z.array(z.string()).meta({
        description: 'Names of the files attached to the answer; the files are not disclosed',
      }),
    })
    .nullable()
    .meta({ description: "The declarant's answer; null when not answered" }),
});
export type DisclosedClarificationItem = z.infer<typeof disclosedClarificationItemSchema>;

export const disclosedClarificationSchema = z.object({
  declarationReference: z.string().meta({ description: 'The declaration it was issued on' }),
  reference: z.string().meta({ description: '`CLR-...`' }),
  status: z.enum(DISCLOSED_STATUSES),
  issuedAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
  responseLate: z.boolean(),
  resolvedAt: z.iso.datetime().nullable(),
  items: z.array(disclosedClarificationItemSchema).min(1),
});
export type DisclosedClarification = z.infer<typeof disclosedClarificationSchema>;

export const clarificationDisclosureSchema = z.object({
  grantReference: z.string(),
  clarifications: z.array(disclosedClarificationSchema).meta({
    description: 'Oldest issued first; empty when none was issued or none is in the scope',
  }),
});
export type ClarificationDisclosure = z.infer<typeof clarificationDisclosureSchema>;

/** An issued clarification as stored, with its declaration and the declarant's response. */
export interface IssuedClarification {
  declarationReference: string;
  reference: string;
  status: DisclosedStatus;
  issuedAt: Date;
  dueAt: Date;
  respondedAt: Date | null;
  responseLate: boolean | null;
  resolvedAt: Date | null;
  items: ClarificationItem[];
  /** The letter's language: an item with no letter text is labelled in it. */
  language: LetterLanguage;
  letter: ClarificationLetter | null;
  response: {
    items: ClarificationResponseItem[];
    attachments: ClarificationResponseAttachment[];
  } | null;
}

function includesPerson(scope: DisclosureScope, personKey: string): boolean {
  if (personKey === 'officer') return true;
  if (personKey.startsWith('spouse:')) return scope.includeSpouses;
  if (personKey.startsWith('child:')) return scope.includeChildren;
  return false;
}

function grants(scope: DisclosureScope, sections: readonly DisclosureSection[]): boolean {
  return sections.every((section) => scope.sections.includes(section));
}

/** Whether a grant of `scope` covers everything `item` can concern. */
export function isItemInScope(item: ClarificationItem, scope: DisclosureScope): boolean {
  const statementOf = item.sectionKey?.startsWith('statement:')
    ? item.sectionKey.slice('statement:'.length)
    : null;
  const person = item.personKey ?? statementOf;
  if (person !== null && !includesPerson(scope, person)) return false;
  switch (item.sectionKey) {
    case 'bio':
      return grants(scope, ['bio']);
    case 'household':
      return grants(scope, ['bio']) && scope.includeSpouses && scope.includeChildren;
    case 'other':
      return grants(scope, ['other']);
    default:
      if (person !== null || item.itemId !== null) return grants(scope, FINANCIAL_SECTIONS);
      return grants(scope, DISCLOSURE_SECTIONS) && scope.includeSpouses && scope.includeChildren;
  }
}

/** The clarification as a grant of `scope` discloses it; null when none of its items is in it. */
export function disclosedClarification(
  clarification: IssuedClarification,
  scope: DisclosureScope,
): DisclosedClarification | null {
  const items = clarification.items.flatMap((item, index) => {
    if (!isItemInScope(item, scope)) return [];
    const lettered = clarification.letter?.items[index];
    const answer = clarification.response?.items.find((each) => each.itemId === item.id);
    return [
      {
        label: lettered?.label ?? itemLabel(item, null, clarification.language),
        requirementLabel:
          lettered?.requirementLabel ??
          REQUIREMENT_LABELS[clarification.language][item.requirement],
        text: lettered?.text ?? item.text,
        response:
          answer === undefined
            ? null
            : {
                text: answer.text,
                attachmentNames: (clarification.response?.attachments ?? [])
                  .filter((attachment) => attachment.itemId === item.id)
                  .map((attachment) => attachment.fileName),
              },
      },
    ];
  });
  if (items.length === 0) return null;
  return {
    declarationReference: clarification.declarationReference,
    reference: clarification.reference,
    status: clarification.status,
    issuedAt: clarification.issuedAt.toISOString(),
    dueAt: clarification.dueAt.toISOString(),
    respondedAt: clarification.respondedAt?.toISOString() ?? null,
    responseLate: clarification.responseLate ?? false,
    resolvedAt: clarification.resolvedAt?.toISOString() ?? null,
    items,
  };
}
