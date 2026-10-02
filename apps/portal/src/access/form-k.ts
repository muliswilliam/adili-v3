import type { FormKV1 } from '@adili/forms';
import type { Scope } from '@adili/ui';
import { z } from 'zod';

import { FORM_K_COPY as COPY } from './copy';

/**
 * The Form K wizard's model (spec 10 FE-3, Regs r.22(1)): what the applicant fills in, step by
 * step, the checks each step runs before it moves on, and the `form-k.v1` document it becomes.
 * The checks mirror `packages/schemas/forms/form-k.v1.json` (lengths, required parts, scope
 * sizes; `form-k.test.ts` holds them to it), on trimmed text, so the service accepts whatever
 * the wizard lets through.
 *
 * The applicant's name, identity document, telephone and email are not part of the draft: they
 * come from the applicant's account (`GET /v1/me/applicant`) and the portal's server fills them
 * in when it submits, so a browser cannot file Form K under someone else's particulars.
 */

export const FORM_K_STEPS = [
  'commission',
  'particulars',
  'officer',
  'information',
  'scope',
  'declare',
] as const;

export type FormKStep = (typeof FORM_K_STEPS)[number];

/** Form K Part IV, word for word (`form-k.v1` holds it as a constant). */
export const DECLARATION_TEXT =
  'I declare that the information I have given above is true, complete and correct to the best of my knowledge.';

export const TEXT_MAX = 4000;

export interface FormKDraft {
  /** The Responsible Commission's slug. */
  commission: string | null;
  postalAddress: string;
  physicalAddress: string;
  occupation: string;
  officer: {
    name: string;
    entity: string;
    workStation: string;
    personnelFileNumber: string;
  };
  information: {
    informationSought: string;
    reason: string;
    otherInformation: string;
  };
  scope: Scope;
  declared: boolean;
}

export function emptyDraft(): FormKDraft {
  return {
    commission: null,
    postalAddress: '',
    physicalAddress: '',
    occupation: '',
    officer: { name: '', entity: '', workStation: '', personnelFileNumber: '' },
    information: { informationSought: '', reason: '', otherInformation: '' },
    scope: {
      years: [],
      includeSpouses: false,
      includeChildren: false,
      sections: [],
    },
    declared: false,
  };
}

/** Required text of `min` to `max` characters once trimmed. */
const text = (min: number, max: number, missing: string, tooLong: string) =>
  z.string().trim().min(min, { error: missing }).max(max, { error: tooLong });

/** Text that may be empty, up to `max` characters once trimmed. */
const optionalText = (max: number, tooLong: string) =>
  z.string().trim().max(max, { error: tooLong });

const commissionSchema = z.object({
  commission: z
    .string({ error: COPY.commissionMissing })
    .regex(/^[a-z][a-z0-9]{1,19}$/, { error: COPY.commissionMissing }),
});

const particularsSchema = z.object({
  postalAddress: text(3, 200, COPY.postalMissing, COPY.addressTooLong),
  physicalAddress: text(3, 200, COPY.physicalMissing, COPY.addressTooLong),
  occupation: text(2, 100, COPY.occupationMissing, COPY.occupationTooLong),
});

const officerSchema = z.object({
  officer: z.object({
    name: text(2, 200, COPY.officerNameMissing, COPY.officerTooLong),
    entity: text(2, 200, COPY.entityMissing, COPY.officerTooLong),
    workStation: optionalText(200, COPY.officerTooLong),
    personnelFileNumber: optionalText(30, COPY.fileNumberTooLong),
  }),
});

const informationSchema = z.object({
  information: z.object({
    informationSought: text(10, TEXT_MAX, COPY.informationMissing, COPY.textTooLong),
    reason: text(10, TEXT_MAX, COPY.reasonMissing, COPY.textTooLong),
    otherInformation: optionalText(TEXT_MAX, COPY.textTooLong),
  }),
});

const scopeSchema = z.object({
  scope: z.object({
    years: z
      .array(z.number().int().min(2025))
      .min(1, { error: COPY.yearsMissing })
      .max(50, { error: COPY.yearsMissing })
      .refine((years) => new Set(years).size === years.length, { error: COPY.yearsMissing }),
    includeSpouses: z.boolean(),
    includeChildren: z.boolean(),
    sections: z
      .array(z.enum(['bio', 'income', 'assets', 'liabilities', 'other']))
      .min(1, { error: COPY.sectionsMissing })
      .refine((sections) => new Set(sections).size === sections.length, {
        error: COPY.sectionsMissing,
      }),
  }),
});

const declareSchema = z.object({
  declared: z.literal(true, { error: COPY.declareMissing }),
});

const STEP_SCHEMAS = {
  commission: commissionSchema,
  particulars: particularsSchema,
  officer: officerSchema,
  information: informationSchema,
  scope: scopeSchema,
  declare: declareSchema,
} satisfies Record<FormKStep, z.ZodType>;

/** The whole draft, checked: what the portal's server accepts from the browser. */
export const formKDraftSchema = commissionSchema
  .extend(particularsSchema.shape)
  .extend(officerSchema.shape)
  .extend(informationSchema.shape)
  .extend(scopeSchema.shape)
  .extend(declareSchema.shape);

export type CheckedDraft = z.infer<typeof formKDraftSchema>;

/** Problems by dotted field path, e.g. `officer.name` or `scope.years`. */
export type StepErrors = Partial<Record<string, string>>;

/** One step's problems, by dotted field path; empty when the step can move on. */
export function stepErrors(step: FormKStep, draft: FormKDraft): StepErrors {
  const result = STEP_SCHEMAS[step].safeParse(draft);
  if (result.success) return {};
  const errors: StepErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= issue.message;
  }
  return errors;
}

/** The first step with problems, or null when the whole draft is ready to submit. */
export function firstInvalidStep(draft: FormKDraft): FormKStep | null {
  return FORM_K_STEPS.find((step) => Object.keys(stepErrors(step, draft)).length > 0) ?? null;
}

/** The applicant's particulars from their account, as Form K Part I needs them. */
export interface AccountParticulars {
  name: string;
  identityDocument: { kind: 'national-id' | 'passport'; number: string; country: string | null };
  telephone: string;
  email: string;
}

/** The `form-k.v1` document a checked draft and the applicant's account make, declared `at`. */
export function toFormK(draft: CheckedDraft, account: AccountParticulars, at: Date): FormKV1 {
  const { officer, information } = draft;
  const { identityDocument } = account;
  return {
    schemaVersion: 'form-k.v1',
    responsibleCommission: draft.commission,
    partI: {
      name: account.name,
      identityDocument: {
        kind: identityDocument.kind,
        number: identityDocument.number,
        ...(identityDocument.kind === 'passport' && identityDocument.country
          ? { country: identityDocument.country }
          : {}),
      },
      postalAddress: draft.postalAddress,
      physicalAddress: draft.physicalAddress,
      telephone: account.telephone,
      email: account.email,
      occupation: draft.occupation,
    },
    partII: {
      name: officer.name,
      entity: officer.entity,
      workStation: officer.workStation,
      ...(officer.personnelFileNumber === ''
        ? {}
        : { personnelFileNumber: officer.personnelFileNumber }),
    },
    partIII: {
      informationSought: information.informationSought,
      reason: information.reason,
      otherInformation: information.otherInformation,
    },
    partIV: { text: DECLARATION_TEXT, declaredAt: at.toISOString() },
    scope: {
      ...draft.scope,
      years: [...draft.scope.years].sort((a, b) => a - b),
    },
  };
}

/** Where a `form-k.v1` field the service refused sits in the wizard. */
const PART_STEPS: Record<string, FormKStep> = {
  responsibleCommission: 'commission',
  partI: 'particulars',
  partII: 'officer',
  partIII: 'information',
  scope: 'scope',
  partIV: 'declare',
};

/** The draft field a `form-k.v1` path names, e.g. `partII.name` → `officer.name`. */
const PART_FIELDS: Record<string, string> = {
  responsibleCommission: 'commission',
  partII: 'officer',
  partIII: 'information',
  scope: 'scope',
  partIV: 'declared',
};

/**
 * The step and draft field of each path the service's 400 named, with that field's message
 * from the wizard's own copy. Paths in Part I that come from the account (name, document,
 * telephone, email) have no field: they land on the particulars step without one.
 */
export function placeServerErrors(paths: string[]): {
  steps: FormKStep[];
  errors: StepErrors;
} {
  const steps = new Set<FormKStep>();
  const errors: StepErrors = {};
  for (const path of paths) {
    const [part = '', field] = path.split('.');
    const step = PART_STEPS[part];
    if (!step) continue;
    steps.add(step);
    const draftPath =
      part === 'partI'
        ? field && ['postalAddress', 'physicalAddress', 'occupation'].includes(field)
          ? field
          : null
        : part === 'responsibleCommission' || part === 'partIV'
          ? (PART_FIELDS[part] ?? null)
          : field
            ? `${PART_FIELDS[part] ?? part}.${field}`
            : null;
    if (draftPath) errors[draftPath] = SERVER_FIELD_COPY[draftPath] ?? COPY.rejectedText;
  }
  return { steps: FORM_K_STEPS.filter((step) => steps.has(step)), errors };
}

const SERVER_FIELD_COPY: Record<string, string> = {
  commission: COPY.commissionMissing,
  postalAddress: COPY.postalMissing,
  physicalAddress: COPY.physicalMissing,
  occupation: COPY.occupationMissing,
  'officer.name': COPY.officerNameMissing,
  'officer.entity': COPY.entityMissing,
  'officer.workStation': COPY.officerTooLong,
  'officer.personnelFileNumber': COPY.fileNumberTooLong,
  'information.informationSought': COPY.informationMissing,
  'information.reason': COPY.reasonMissing,
  'information.otherInformation': COPY.textTooLong,
  'scope.years': COPY.yearsMissing,
  'scope.sections': COPY.sectionsMissing,
  declared: COPY.declareMissing,
};

/**
 * A new draft from an earlier request's Form K, for "New request with these details" after a
 * Commission could not identify the officer: everything but the declaration, to check and
 * correct before declaring again.
 */
export function draftFrom(formK: FormKV1): FormKDraft {
  return {
    commission: formK.responsibleCommission,
    postalAddress: formK.partI.postalAddress,
    physicalAddress: formK.partI.physicalAddress,
    occupation: formK.partI.occupation,
    officer: {
      name: formK.partII.name,
      entity: formK.partII.entity,
      workStation: formK.partII.workStation,
      personnelFileNumber: formK.partII.personnelFileNumber ?? '',
    },
    information: {
      informationSought: formK.partIII.informationSought,
      reason: formK.partIII.reason,
      otherInformation: formK.partIII.otherInformation,
    },
    scope: { ...formK.scope },
    declared: false,
  };
}
