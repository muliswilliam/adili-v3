import type { Draft, Officer } from './contents';
import { ageOn, blank } from './format';

/** The fields the declarant fills in on Your details (paragraphs 2-5). */
export type BioField =
  | 'birthDate'
  | 'birthPlace'
  | 'maritalStatus'
  | 'maritalChange'
  | 'postal'
  | 'physical'
  | 'nature'
  | 'natureOther';

/** JSON pointers into the officer section, as the service reports issues. */
export const BIO_FIELD_PATHS: Record<BioField, string> = {
  birthDate: '/birth/date',
  birthPlace: '/birth/place',
  maritalStatus: '/maritalStatus',
  maritalChange: '/maritalStatusChange/explanation',
  postal: '/address/postal',
  physical: '/address/physical',
  nature: '/employment/nature',
  natureOther: '/employment/natureOther',
};

/** Screen order, so focus goes to the first field to fix. */
export const BIO_FIELD_ORDER: BioField[] = [
  'birthDate',
  'birthPlace',
  'maritalStatus',
  'postal',
  'physical',
  'maritalChange',
  'nature',
  'natureOther',
];

export interface BioIssue {
  /** `missing` waits until the field was visited; `invalid` shows as soon as it is typed. */
  kind: 'missing' | 'invalid';
  message: string;
}

export type BioIssues = Partial<Record<BioField, BioIssue>>;

export const BIO_MESSAGES = {
  birthDate: 'Enter your date of birth.',
  dateFormat: 'Enter a real date as DD/MM/YYYY.',
  birthDateAge: 'Check your date of birth. You must be 18 to 100 years old on the statement date.',
  birthPlace: 'Enter your place of birth.',
  maritalStatus: 'Choose your marital status.',
  maritalChange: 'Explain the change in marital status.',
  postal: 'Enter your postal address.',
  physical: 'Enter your physical address.',
  nature: 'Choose the nature of your employment.',
  natureOther: 'Describe the nature of your employment.',
} as const;

/**
 * What stops Your details from being complete, keyed by field. The rules follow
 * declaration.v1 (`officer`) and the spec's bio table: date of birth 18-100 years before the
 * statement date, place 2-100 characters, addresses 3-200, an explanation when marital status
 * changed, and a description when the nature of employment is Other.
 */
export function bioIssues(officer: Draft<Officer>, statementDate: string): BioIssues {
  const issues: BioIssues = {};
  const birthDate = officer.birth?.date;
  if (blank(birthDate)) {
    issues.birthDate = { kind: 'missing', message: BIO_MESSAGES.birthDate };
  } else if (birthDate) {
    const age = ageOn(birthDate, statementDate);
    if (age < 18 || age > 100)
      issues.birthDate = { kind: 'invalid', message: BIO_MESSAGES.birthDateAge };
  }

  const place = officer.birth?.place?.trim() ?? '';
  if (place.length < 2) issues.birthPlace = { kind: 'missing', message: BIO_MESSAGES.birthPlace };

  if (!officer.maritalStatus) {
    issues.maritalStatus = { kind: 'missing', message: BIO_MESSAGES.maritalStatus };
  }
  if (officer.maritalStatusChange?.changed && blank(officer.maritalStatusChange.explanation)) {
    issues.maritalChange = { kind: 'missing', message: BIO_MESSAGES.maritalChange };
  }

  if ((officer.address?.postal?.trim() ?? '').length < 3) {
    issues.postal = { kind: 'missing', message: BIO_MESSAGES.postal };
  }
  if ((officer.address?.physical?.trim() ?? '').length < 3) {
    issues.physical = { kind: 'missing', message: BIO_MESSAGES.physical };
  }

  if (!officer.employment?.nature) {
    issues.nature = { kind: 'missing', message: BIO_MESSAGES.nature };
  } else if (officer.employment.nature === 'other' && blank(officer.employment.natureOther)) {
    issues.natureOther = { kind: 'missing', message: BIO_MESSAGES.natureOther };
  }
  return issues;
}
