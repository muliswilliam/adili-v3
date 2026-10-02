import { GRANT_REFERENCE_PATTERN, isGrantReference } from '@adili/numbering/references';
import { z } from 'zod';

/**
 * What the two documents a grant delivers share (spec 10): the access package and the nil letter
 * both name the grant's reference, legal basis, recipient, decision time and scope.
 */

/** The provisions a grant rests on (declarations' `LegalBasis`). */
export const LEGAL_BASES = ['act-s36-1', 'act-s36-2'] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

/** The sections a grant discloses (declarations' `DisclosureSection`). */
export const DISCLOSURE_SECTIONS = ['bio', 'income', 'assets', 'liabilities', 'other'] as const;

const SECTION_NAMES: Record<(typeof DISCLOSURE_SECTIONS)[number], string> = {
  bio: 'Biodata',
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
  other: 'Other information',
};

export const grantReferenceSchema = z
  .string()
  .regex(GRANT_REFERENCE_PATTERN)
  .refine(isGrantReference, {
    message: 'Must be an ARQ or LEA reference number with a valid check character',
  })
  .meta({
    description: 'The access request (ARQ) or law-enforcement request (LEA) reference',
    examples: ['ARQ-PSC-2026-0000012-H'],
  });

export const legalBasisSchema = z.enum(LEGAL_BASES).meta({
  description: 'act-s36-1: an access request (Form K); act-s36-2: a law-enforcement request',
});

export const grantRecipientSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  /** The law-enforcement agency, for a law-enforcement request. */
  organisation: z.string().trim().min(1).max(200).nullable(),
});
export type GrantRecipient = z.infer<typeof grantRecipientSchema>;

/** The scope granted, printed on the document. */
export const grantedScopeSchema = z.strictObject({
  years: z.array(z.int().min(2000).max(2100)).min(1),
  includeSpouses: z.boolean(),
  includeChildren: z.boolean(),
  sections: z.array(z.enum(DISCLOSURE_SECTIONS)).min(1),
  /** Form K only (Act s.36(1), Regulation 22(1)); never for a law-enforcement request. */
  includeClarifications: z.boolean(),
});
export type GrantedScope = z.infer<typeof grantedScopeSchema>;

export const LEGAL_BASIS_TEXT: Record<LegalBasis, string> = {
  'act-s36-1': 'Access request under section 36(1) of the Act (Form K)',
  'act-s36-2': 'Law-enforcement request under section 36(2) of the Act (Regulation 23)',
};

/** The scope as the documents print it, one line each. */
export function scopeText(scope: GrantedScope): string[] {
  const years = [...scope.years].sort((a, b) => a - b).join(', ');
  const household = [
    'the declarant',
    ...(scope.includeSpouses ? ['spouses'] : []),
    ...(scope.includeChildren ? ['children'] : []),
  ].join(', ');
  return [
    `Declarations of ${years}`,
    `Persons: ${household}`,
    `Sections: ${scope.sections.map((section) => SECTION_NAMES[section]).join(', ')}`,
    ...(scope.includeClarifications ? ['Clarifications the declarant gave'] : []),
  ];
}

/** `Amina Otieno` or, for a law-enforcement officer, `Peter Mwangi, Directorate of ...`. */
export function issuedTo(recipient: GrantRecipient): string {
  return recipient.organisation ? `${recipient.name}, ${recipient.organisation}` : recipient.name;
}
