/* Generated from @adili/schemas/forms/declaration.v1.json by scripts/generate-types.ts. Do not edit. */

import { z } from 'zod';

export const CHANGE_KINDS = [
  'value-change',
  'acquisition',
  'disposal',
  'new-source',
  'source-ended',
  'settled',
] as const;

export const ITEM_SOURCE_KINDS = ['kra', 'ntsa', 'brs', 'ardhisasa', 'document'] as const;

export const OCCUPATION_SECTORS = ['public', 'private', 'not-employed', 'unknown'] as const;

export const INCOME_TYPES = [
  'salary-emoluments',
  'allowances',
  'business',
  'rent',
  'dividends-interest',
  'pension',
  'farming',
  'consultancy',
  'other',
] as const;

export const ASSET_TYPES = [
  'land',
  'building',
  'vehicle',
  'securities',
  'shareholding',
  'bank-account',
  'cash',
  'receivable',
  'other',
] as const;

export const LIABILITY_TYPES = ['mortgage', 'loan', 'guarantee', 'other'] as const;

export const MATERIAL_CHANGE_KINDS = [
  'value-change',
  'acquisition',
  'disposal',
  'new-source',
  'source-ended',
  'settled',
  'marital-status',
  'directorship',
  'membership',
] as const;

export const MEMBERSHIP_KINDS = [
  'company',
  'partnership',
  'society',
  'club',
  'foundation',
  'trust',
  'other',
] as const;

export const DECLARATION_TYPES = ['initial', 'biennial', 'final'] as const;

export const INCOME_PERIOD_SOURCES = ['declared', 'assumed'] as const;

export const MARITAL_STATUSES = ['single', 'married', 'separated', 'divorced', 'widowed'] as const;

export const EMPLOYMENT_NATURES = ['permanent', 'temporary', 'contract', 'other'] as const;

export const ATTESTATION_TEXT =
  'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.';

export const PersonNameSchema = z.strictObject({
  surname: z.string().min(1).max(100),
  firstName: z.string().min(1).max(100),
  otherNames: z.string().max(200).optional(),
});

export const PersonKeySchema = z
  .string()
  .regex(/^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$/u);

export const MoneySchema = z.strictObject({
  kesCents: z.int().min(0),
  original: z
    .strictObject({
      currency: z.string().regex(/^[A-Z]{3}$/u),
      minorUnits: z.int().min(0),
    })
    .optional(),
});

export const LocationSchema = z.strictObject({
  inKenya: z.boolean(),
  county: z
    .string()
    .regex(/^0(0[1-9]|[1-3][0-9]|4[0-7])$/u)
    .optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .optional(),
  detail: z.string().max(200).optional(),
});

/** Act s.31(3)-(4): change since the previous declaration */
export const ChangeFlagSchema = z
  .strictObject({
    changed: z.boolean(),
    kind: z.enum(CHANGE_KINDS).optional(),
    explanation: z.string().min(1).max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.changed === true) {
      if (value.kind === undefined)
        ctx.addIssue({ code: 'custom', path: ['kind'], message: 'is required' });
      if (value.explanation === undefined)
        ctx.addIssue({ code: 'custom', path: ['explanation'], message: 'is required' });
    }
  });

export const MaritalStatusChangeSchema = z
  .strictObject({
    changed: z.boolean(),
    explanation: z.string().min(1).max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.changed === true) {
      if (value.explanation === undefined)
        ctx.addIssue({ code: 'custom', path: ['explanation'], message: 'is required' });
    }
  });

export const AttachmentSchema = z.strictObject({
  attachmentId: z.guid(),
  uploadId: z.guid(),
  fileName: z.string().max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

/** Where a pre-filled item came from (spec 05b); absent for manually entered items */
export const ItemSourceSchema = z.strictObject({
  kind: z.enum(ITEM_SOURCE_KINDS),
  suggestionId: z.guid(),
  verificationResultId: z.guid().optional(),
  aiJobId: z.guid().optional(),
  at: z.iso.datetime({ offset: true }),
});

export const SpouseSchema = z.strictObject({
  id: z.guid(),
  name: PersonNameSchema,
  nationalId: z
    .string()
    .regex(/^[0-9]{5,10}$/u)
    .optional(),
  kraPin: z
    .string()
    .regex(/^[AP][0-9]{9}[A-Z]$/u)
    .optional(),
  occupationSector: z.enum(OCCUPATION_SECTORS).optional(),
  separated: z.boolean(),
  separationDate: z.iso.date().optional(),
});

export const ChildSchema = z.strictObject({
  id: z.guid(),
  name: PersonNameSchema,
  dateOfBirth: z.iso.date(),
  nationalId: z
    .string()
    .regex(/^[0-9]{5,10}$/u)
    .optional(),
  includedAtStatementDate: z.boolean(),
});

export const IncomeItemSchema = z.strictObject({
  id: z.guid(),
  type: z.enum(INCOME_TYPES),
  description: z.string().min(1).max(200),
  amount: MoneySchema,
  location: LocationSchema,
  change: ChangeFlagSchema,
  source: ItemSourceSchema.optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

export const AssetItemSchema = z.strictObject({
  id: z.guid(),
  type: z.enum(ASSET_TYPES),
  description: z.string().min(1).max(200),
  details: z
    .strictObject({
      parcelNumber: z.string().max(100).optional(),
      size: z.string().max(50).optional(),
      registration: z.string().max(20).optional(),
      makeModel: z.string().max(100).optional(),
      issuer: z.string().max(200).optional(),
      quantityOrPercent: z.string().max(50).optional(),
      institution: z.string().max(200).optional(),
      accountType: z.string().max(50).optional(),
      debtor: z.string().max(200).optional(),
    })
    .optional(),
  value: MoneySchema,
  location: LocationSchema,
  joint: z
    .strictObject({
      isJoint: z.boolean(),
      sharePercent: z.number().gt(0).max(100).optional(),
      coOwner: z.string().max(200).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.isJoint === true) {
        if (value.sharePercent === undefined)
          ctx.addIssue({ code: 'custom', path: ['sharePercent'], message: 'is required' });
      }
    }),
  change: ChangeFlagSchema,
  source: ItemSourceSchema.optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

export const LiabilityItemSchema = z.strictObject({
  id: z.guid(),
  type: z.enum(LIABILITY_TYPES),
  description: z.string().min(1).max(200),
  creditor: z.string().min(1).max(200),
  outstanding: MoneySchema,
  location: LocationSchema,
  change: ChangeFlagSchema,
  source: ItemSourceSchema.optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

/** Paragraph 8 for one person */
export const StatementSchema = z
  .strictObject({
    personKey: PersonKeySchema,
    personName: PersonNameSchema,
    statementDate: z.iso.date(),
    incomePeriod: z.strictObject({
      from: z.iso.date(),
      to: z.iso.date(),
    }),
    incomeNil: z.boolean(),
    income: z.array(IncomeItemSchema),
    assetsNil: z.boolean(),
    assets: z.array(AssetItemSchema),
    liabilitiesNil: z.boolean(),
    liabilities: z.array(LiabilityItemSchema),
    knowledgeLimitation: z.string().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.incomeNil === true) {
      if (value.income.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['income'],
          message: 'must NOT have more than 0 items',
        });
    } else {
      if (value.income.length < 1)
        ctx.addIssue({
          code: 'custom',
          path: ['income'],
          message: 'must NOT have fewer than 1 items',
        });
    }
    if (value.assetsNil === true) {
      if (value.assets.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'must NOT have more than 0 items',
        });
    } else {
      if (value.assets.length < 1)
        ctx.addIssue({
          code: 'custom',
          path: ['assets'],
          message: 'must NOT have fewer than 1 items',
        });
    }
    if (value.liabilitiesNil === true) {
      if (value.liabilities.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['liabilities'],
          message: 'must NOT have more than 0 items',
        });
    } else {
      if (value.liabilities.length < 1)
        ctx.addIssue({
          code: 'custom',
          path: ['liabilities'],
          message: 'must NOT have fewer than 1 items',
        });
    }
  });

export const MaterialChangeEntrySchema = z.strictObject({
  personKey: PersonKeySchema.optional(),
  itemId: z.guid().optional(),
  itemDescription: z.string().max(200).optional(),
  kind: z.enum(MATERIAL_CHANGE_KINDS),
  explanation: z.string().max(1000),
});

/** Second Schedule vocabulary relevant to paragraph 9 */
export const RegistrableInterestsSchema = z.strictObject({
  directorships: z.array(
    z.strictObject({
      company: z.string().max(200),
      role: z.string().max(100),
      remunerated: z.boolean(),
      change: ChangeFlagSchema.optional(),
    }),
  ),
  memberships: z.array(
    z.strictObject({
      entity: z.string().max(200),
      kind: z.enum(MEMBERSHIP_KINDS),
      change: ChangeFlagSchema.optional(),
    }),
  ),
  dualCitizenship: z.strictObject({
    holds: z.boolean(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .optional(),
    pendingApplication: z.boolean(),
  }),
  pendingCases: z.array(
    z.strictObject({
      forum: z.string().max(200),
      reference: z.string().max(100),
      nature: z.string().max(500),
    }),
  ),
});

/** One declaration as submitted by a public officer: paragraphs 1-9 of the First Schedule. Amounts are integers in minor units (KES cents). Draft: spec 05. */
export const DeclarationSchema = z.strictObject({
  schemaVersion: z.literal('declaration.v1'),
  type: z.enum(DECLARATION_TYPES),
  statementDate: z.iso.date(),
  incomePeriod: z.strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    fromSource: z.enum(INCOME_PERIOD_SOURCES),
  }),
  officer: z.strictObject({
    name: PersonNameSchema,
    birth: z.strictObject({
      date: z.iso.date(),
      place: z.string().min(2).max(100),
    }),
    maritalStatus: z.enum(MARITAL_STATUSES),
    maritalStatusChange: MaritalStatusChangeSchema.optional(),
    address: z.strictObject({
      postal: z.string().min(3).max(200),
      physical: z.string().min(3).max(200),
    }),
    employment: z.strictObject({
      designation: z.string().max(100),
      employer: z.string().max(200),
      nature: z.enum(EMPLOYMENT_NATURES),
      natureOther: z.string().max(100).optional(),
      responsibleCommission: z.string().regex(/^[a-z][a-z0-9]{1,19}$/u),
      personnelFileNumber: z.string().max(30).optional(),
      jobGroup: z.string().max(40).optional(),
      appointmentDate: z.iso.date().optional(),
      workStation: z.string().max(100).optional(),
    }),
  }),
  spouses: z.strictObject({
    none: z.boolean(),
    items: z.array(SpouseSchema),
  }),
  children: z.strictObject({
    none: z.boolean(),
    items: z.array(ChildSchema),
  }),
  statements: z.array(StatementSchema).min(1),
  otherInformation: z.strictObject({
    materialChanges: z.array(MaterialChangeEntrySchema),
    registrableInterests: RegistrableInterestsSchema,
    freeText: z.string().max(4000),
  }),
  attestation: z.strictObject({
    text: z.literal(ATTESTATION_TEXT),
    declaredAt: z.iso.datetime({ offset: true }).optional(),
    reference: z.string().optional(),
  }),
});
