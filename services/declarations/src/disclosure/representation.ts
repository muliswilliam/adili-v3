import {
  GRANT_LEGAL_BASES,
  GRANT_REFERENCE_PATTERN,
  grantLegalBasis,
  type GrantLegalBasis,
  isGrantReference,
} from '@adili/numbering/references';
import { z } from 'zod';

import { declarationReferenceSchema } from '../declaration/reference.js';
import { commissionRefSchema, obligationTypeSchema } from '../obligations/representation.js';
import { DISCLOSURE_SECTIONS } from './scope.js';

/**
 * Bodies of the disclosure API (spec 10): the scoped disclosure of a person's submitted
 * declarations for an access grant, and the full document of a version for the declarant's
 * certified copy. They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

/**
 * The provision a grant rests on: Act s.36(1) for a Form K request (`ARQ`), s.36(2) for a
 * law-enforcement request (`LEA`, Regulation 23).
 */
export type LegalBasis = GrantLegalBasis;

/** The legal basis of a certified copy, the declarant's access to their own record (AM 32). */
export const SELF_ACCESS = 'self-access';

export const disclosureSectionSchema = z.enum(DISCLOSURE_SECTIONS).meta({
  description:
    "`bio`: the officer's particulars, with the included spouses' and children's; `income`, `assets`, `liabilities`: those parts of the included persons' statements; `other`: other information",
});

export const legalBasisSchema = z.enum(GRANT_LEGAL_BASES).meta({
  description: 'Act s.36(1) for a Form K grant (ARQ), s.36(2) for a law-enforcement grant (LEA)',
});

export const grantReferenceSchema = z
  .string()
  .regex(GRANT_REFERENCE_PATTERN)
  .refine(isGrantReference, {
    message: 'not a valid ARQ or LEA reference (check character)',
  })
  .meta({
    description: "ADR-011: the access request's ARQ (Form K) or LEA (law enforcement) reference",
    examples: ['ARQ-PSC-2028-0000012-N'],
  });

export const disclosureRequestSchema = z
  .strictObject({
    personId: z.uuid().meta({ description: 'The declarant whose declarations are disclosed' }),
    grantReference: grantReferenceSchema,
    legalBasis: legalBasisSchema,
    recipientSubject: z.string().min(1).max(255).meta({
      description:
        'The account the disclosure is handed to (the applicant, the law-enforcement officer); recorded in the audit event',
    }),
    years: z
      .array(z.int().min(2000).max(2100))
      .min(1)
      .max(50)
      .meta({ description: "Declaration years: the statement dates' years" }),
    includeSpouses: z.boolean(),
    includeChildren: z.boolean(),
    sections: z.array(disclosureSectionSchema).min(1).max(DISCLOSURE_SECTIONS.length),
  })
  .refine((request) => grantLegalBasis(request.grantReference) === request.legalBasis, {
    path: ['legalBasis'],
    message: 'act-s36-1 goes with an ARQ reference, act-s36-2 with an LEA reference',
  })
  .meta({ description: 'The granted scope of an access request, and whom it is disclosed to' });
export type DisclosureRequest = z.infer<typeof disclosureRequestSchema>;

/**
 * What the access officer weighs a scope with before deciding (spec 10, decision 1): the same
 * scope as a disclosure, counted instead of rendered. The officer asking (`X-Acting-Subject`) is
 * the one who sees the counts, so there is no other recipient.
 */
export const disclosureCountsRequestSchema = z
  .strictObject({
    personId: z.uuid().meta({ description: 'The declarant whose declarations are counted' }),
    grantReference: grantReferenceSchema,
    legalBasis: legalBasisSchema,
    years: z
      .array(z.int().min(2000).max(2100))
      .min(1)
      .max(50)
      .meta({ description: "Declaration years: the statement dates' years" }),
    includeSpouses: z.boolean(),
    includeChildren: z.boolean(),
    sections: z.array(disclosureSectionSchema).min(1).max(DISCLOSURE_SECTIONS.length),
  })
  .refine((request) => grantLegalBasis(request.grantReference) === request.legalBasis, {
    path: ['legalBasis'],
    message: 'act-s36-1 goes with an ARQ reference, act-s36-2 with an LEA reference',
  })
  .meta({ description: 'A scope an access officer is about to decide on, to be counted' });
export type DisclosureCountsRequest = z.infer<typeof disclosureCountsRequestSchema>;

const countSchema = z.int().min(0);

export const disclosureYearCountsSchema = z.object({
  year: z.int().meta({ description: "A year of the scope: the statement dates' year" }),
  declarations: countSchema.meta({
    description: "The person's declarations at the Commission that year (versions in force)",
  }),
  declarationReferences: z.array(declarationReferenceSchema).meta({
    description:
      'Their reference numbers, for counting the clarifications issued on them; the access service never shows them',
  }),
  sections: z
    .object({
      bio: countSchema.optional(),
      income: countSchema.optional(),
      assets: countSchema.optional(),
      liabilities: countSchema.optional(),
      other: countSchema.optional(),
    })
    .meta({
      description:
        "Per section of the scope (absent: not in it): `bio` the persons whose particulars would go out, `income`, `assets`, `liabilities` the entries of the included persons' statements, `other` the material changes, directorships, memberships, pending cases and a written statement",
    }),
  spouses: countSchema
    .nullable()
    .meta({ description: 'The spouses anything would go out about; null when not included' }),
  children: countSchema
    .nullable()
    .meta({ description: 'The children anything would go out about; null when not included' }),
});
export type DisclosureYearCounts = z.infer<typeof disclosureYearCountsSchema>;

export const disclosureCountsSchema = z
  .object({
    years: z.array(disclosureYearCountsSchema).meta({
      description: 'Every year of the scope, ascending, with zero counts for a year with none',
    }),
  })
  .meta({
    description:
      "How much a scope would disclose of a person's declarations, in counts only: never content",
  });
export type DisclosureCounts = z.infer<typeof disclosureCountsSchema>;

export const disclosedVersionSchema = z.object({
  reference: declarationReferenceSchema,
  version: z.int().min(1),
  type: obligationTypeSchema,
  statementDate: z.iso.date(),
  submittedAt: z.iso.datetime(),
  content: z.record(z.string(), z.unknown()).meta({
    description:
      'The declaration.v1 document cut to the granted scope: always `schemaVersion`, `type`, `statementDate` and `attestation`; with `bio`, `officer` (and `spouses`, `children` when included, without their national IDs, KRA PINs or dates of birth); with `income`, `assets` or `liabilities`, `statements` of the included persons holding only those parts (`incomePeriod` too with `income`); with `other`, `otherInformation` (material changes of the included persons). A key that is absent was not granted',
  }),
});
export type DisclosedVersion = z.infer<typeof disclosedVersionSchema>;

export const disclosureDocumentSchema = z
  .object({
    schemaVersion: z.literal('disclosure.v1'),
    grantReference: grantReferenceSchema,
    personName: z
      .string()
      .meta({ description: 'The declarant as named in the latest disclosed version' }),
    commission: commissionRefSchema,
    versions: z.array(disclosedVersionSchema).min(1).meta({
      description:
        "Per granted year, the version in force of each of the person's declarations at the Commission, by statement date. A granted year with none has no entry",
    }),
  })
  .meta({ description: "disclosure.v1: what a grant discloses of a declarant's declarations" });
export type DisclosureDocument = z.infer<typeof disclosureDocumentSchema>;

export const fullDocumentRequestSchema = z
  .strictObject({
    personId: z
      .uuid()
      .meta({ description: 'The declarant asking for the copy: the version must be theirs' }),
    recipient: z.string().trim().min(1).max(255).meta({
      description:
        "Whom the certified copy is handed to, recorded in the audit event: the declarant's account (token subject) when they asked online; for a written application made in person, the representative's name when made through one, else the declarant",
    }),
  })
  .meta({ description: 'Whose version is asked for in full, and whom the certified copy goes to' });
export type FullDocumentRequest = z.infer<typeof fullDocumentRequestSchema>;

export const fullVersionDocumentSchema = z
  .object({
    declarationId: z.uuid(),
    versionId: z.uuid(),
    version: z.int().min(1),
    personId: z.uuid().meta({ description: 'The declarant' }),
    reference: declarationReferenceSchema,
    type: obligationTypeSchema,
    statementDate: z.iso.date(),
    submittedAt: z.iso.datetime(),
    canonicalSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .meta({ description: "Hex SHA-256 of the document's RFC 8785 canonical JSON" }),
    commission: commissionRefSchema,
    declarantName: z
      .string()
      .meta({ description: 'As declared in the version (first, other and surname)' }),
    document: z.record(z.string(), z.unknown()).meta({
      description: 'The immutable declaration.v1 document as submitted, decrypted',
    }),
  })
  .meta({ description: "A submitted version in full, for the declarant's certified copy" });
export type FullVersionDocument = z.infer<typeof fullVersionDocumentSchema>;
