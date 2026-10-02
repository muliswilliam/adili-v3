import { z } from 'zod';

import type { IdentityDocumentKind, StartApplicantOnboarding } from '../../server/directory/types';
import { CONTACT_ERRORS, normalisePhone } from '../onboarding/contact';
import { DETAILS_FIELD_ERRORS_COPY } from './copy';

/** What the applicant reads for a field that is not right yet. */
export const DETAILS_ERRORS = {
  ...DETAILS_FIELD_ERRORS_COPY,
  email: CONTACT_ERRORS.email,
};

/** A name as the directory takes it (`StartApplicantOnboarding.names`): letters in any script. */
const NAME = /^\p{L}[\p{L}\p{M}' .-]*$/u;

/**
 * A mobile number in E.164, or null. National ID holders give a Kenyan mobile; passport holders
 * may give any mobile with its country code, or a Kenyan one written locally.
 */
export function applicantPhone(kind: IdentityDocumentKind, input: string): string | null {
  const kenyan = normalisePhone(input);
  if (kenyan || kind === 'national-id') return kenyan;
  const compact = input.trim().replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null;
}

function name(required: string) {
  return z
    .string()
    .trim()
    .min(1, required)
    .max(100, DETAILS_ERRORS.name)
    .regex(NAME, DETAILS_ERRORS.name);
}

/** The Your details form, as the applicant types it. */
export interface DetailsInput {
  kind: IdentityDocumentKind;
  surname: string;
  firstName: string;
  otherNames: string;
  number: string;
  /** ISO 3166-1 alpha-2; empty for a national ID. */
  country: string;
  phone: string;
  email: string;
}

export type DetailsField = Exclude<keyof DetailsInput, 'kind'>;
export type DetailsFieldErrors = Partial<Record<DetailsField, string>>;

/** The fields in the order the form shows them, for focusing the first one to fix. */
export const DETAILS_FIELDS: readonly DetailsField[] = [
  'surname',
  'firstName',
  'otherNames',
  'number',
  'country',
  'phone',
  'email',
];

/**
 * The form checked in the browser and again in the server function, as the directory's start
 * body: names trimmed, the document number without spaces (a passport's upper-cased) and the
 * phone in E.164.
 */
/** A phone field normalised to E.164 for the ID type, with the type's error. */
function phone(kind: IdentityDocumentKind) {
  return z
    .string()
    .max(30)
    .transform((value, context) => {
      const e164 = applicantPhone(kind, value);
      if (e164 === null) {
        context.addIssue({
          code: 'custom',
          message: kind === 'passport' ? DETAILS_ERRORS.anyPhone : DETAILS_ERRORS.kenyanPhone,
        });
        return z.NEVER;
      }
      return e164;
    });
}

/** Every field checks itself, so one wrong field never hides another's error. */
const commonFields = {
  surname: name(DETAILS_ERRORS.surname),
  firstName: name(DETAILS_ERRORS.firstName),
  otherNames: z.union([z.literal(''), name(DETAILS_ERRORS.name)]),
  email: z.string().trim().pipe(z.email(DETAILS_ERRORS.email).max(254)),
};

/** A document number without spaces, upper-cased, matching `pattern`. */
function documentNumber(pattern: RegExp, message: string) {
  return z
    .string()
    .max(30)
    .transform((value) => value.replace(/\s/g, '').toUpperCase())
    .pipe(z.string().regex(pattern, message));
}

export const detailsSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('national-id'),
      ...commonFields,
      number: documentNumber(/^\d{5,10}$/, DETAILS_ERRORS.nationalId),
      country: z.string(),
      phone: phone('national-id'),
    }),
    z.object({
      kind: z.literal('passport'),
      ...commonFields,
      number: documentNumber(/^[A-Z0-9]{5,20}$/, DETAILS_ERRORS.passport),
      country: z
        .string()
        .transform((value) => value.trim().toUpperCase())
        .pipe(z.string().regex(/^[A-Z]{2}$/, DETAILS_ERRORS.country)),
      phone: phone('passport'),
    }),
  ])
  .transform((input): StartApplicantOnboarding => ({
    identityDocument:
      input.kind === 'passport'
        ? { kind: 'passport', number: input.number, country: input.country }
        : { kind: 'national-id', number: input.number },
    names: {
      surname: input.surname,
      firstName: input.firstName,
      ...(input.otherNames ? { otherNames: input.otherNames } : {}),
    },
    phone: input.phone,
    email: input.email,
  }));

/** Field errors for the form, or null when it is valid. */
export function detailsErrors(input: DetailsInput): DetailsFieldErrors | null {
  const result = detailsSchema.safeParse(input);
  if (result.success) return null;
  const errors: DetailsFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as DetailsField;
    errors[field] ??= issue.message;
  }
  return errors;
}

/**
 * The form field a directory field error points at (`errors[].path` of a 400), e.g.
 * `identityDocument.number`, or null for one the form does not have.
 */
export function fieldForPath(path: string): DetailsField | null {
  const fields: Record<string, DetailsField> = {
    'names.surname': 'surname',
    'names.firstName': 'firstName',
    'names.otherNames': 'otherNames',
    'identityDocument.number': 'number',
    'identityDocument.country': 'country',
    phone: 'phone',
    email: 'email',
  };
  return fields[path] ?? null;
}

/** The message for a field the directory refused, in the form's words. */
export function refusedFieldMessage(kind: IdentityDocumentKind, field: DetailsField): string {
  switch (field) {
    case 'surname':
    case 'firstName':
    case 'otherNames':
      return DETAILS_ERRORS.name;
    case 'number':
      return kind === 'passport' ? DETAILS_ERRORS.passport : DETAILS_ERRORS.nationalId;
    case 'country':
      return DETAILS_ERRORS.country;
    case 'phone':
      return kind === 'passport' ? DETAILS_ERRORS.anyPhone : DETAILS_ERRORS.kenyanPhone;
    case 'email':
      return DETAILS_ERRORS.email;
  }
}
