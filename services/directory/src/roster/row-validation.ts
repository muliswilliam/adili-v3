import type { RosterField } from './columns.js';
import {
  EMAIL_MAX_LENGTH,
  fileNumberKey as keyOf,
  normaliseEmail,
  normaliseNationalId,
  normalisePhone,
  PHONE_MAX_LENGTH,
} from './normalise.js';

/** `RowError.code` in the contract; `identity-locked` is raised later, when rows are applied. */
export const ROW_ERROR_CODES = [
  'required',
  'format',
  'too-long',
  'future-date',
  'duplicate-in-file',
  'identity-locked',
] as const;
export type RowErrorCode = (typeof ROW_ERROR_CODES)[number];

export interface RowError {
  field: RosterField;
  code: RowErrorCode;
  message: string;
}

export const ROW_NOTE_CODES = ['national-id-on-another-roster'] as const;
export type RowNoteCode = (typeof ROW_NOTE_CODES)[number];

/** Something to know about an accepted row that does not stop it from applying. */
export interface RowNote {
  field: RosterField;
  code: RowNoteCode;
  message: string;
}

/** A row as read from a file or an API batch, keyed by field, before normalisation. */
export type RawRosterRow = Partial<Record<RosterField, string | null>>;

/** An accepted row: trimmed, spaces collapsed, email lower-cased, phone E.164, date ISO. */
export interface NormalisedRosterRow {
  personnelFileNumber: string;
  fullName: string;
  nationalId: string;
  designation: string | null;
  jobGroup: string | null;
  reportingEntity: string | null;
  /** The HR and payroll systems' code for the employer, e.g. `KEMSA`. */
  employerCode: string | null;
  /** `YYYY-MM-DD` */
  appointmentDate: string | null;
  email: string | null;
  /** E.164, e.g. `+254712345678` */
  phone: string | null;
}

export type RowValidation =
  | { status: 'accepted'; normalised: NormalisedRosterRow; errors: [] }
  | { status: 'rejected'; normalised: null; errors: RowError[] };

export interface RowValidatorOptions {
  /** `YYYY-MM-DD`; appointment dates after it are rejected. Defaults to today in Nairobi. */
  today?: string;
}

/**
 * Validates the rows of one file or batch in order. Stateful: a personnel file number or national
 * ID of an earlier accepted row (by its row number) rejects the later row with
 * `duplicate-in-file`. Only the keys are remembered, never the rows.
 */
export function createRowValidator(
  options: RowValidatorOptions = {},
): (raw: RawRosterRow, rowNumber: number) => RowValidation {
  const today = options.today ?? todayInNairobi();
  const fileNumbers = new Map<string, number>();
  const nationalIds = new Map<string, number>();

  return (raw, rowNumber) => {
    const errors: RowError[] = [];
    const fail = (field: RosterField, code: RowErrorCode, message: string): null => {
      errors.push({ field, code, message });
      return null;
    };

    const fileNumberInput = collapse(raw.personnelFileNumber);
    const personnelFileNumber =
      fileNumberInput === ''
        ? fail('personnelFileNumber', 'required', 'Enter the personnel file number')
        : fileNumberInput.length > 30
          ? fail('personnelFileNumber', 'too-long', 'Enter 1 to 30 characters')
          : FILE_NUMBER.test(fileNumberInput)
            ? fileNumberInput
            : fail('personnelFileNumber', 'format', 'Use only letters, digits, /, - or .');

    const fullNameInput = collapse(raw.fullName);
    const fullName =
      fullNameInput === ''
        ? fail('fullName', 'required', 'Enter the full name')
        : fullNameInput.length > 200
          ? fail('fullName', 'too-long', 'Enter 2 to 200 characters')
          : fullNameInput.length < 2
            ? fail('fullName', 'format', 'Enter 2 to 200 characters')
            : fullNameInput;

    const nationalIdInput = normaliseNationalId(raw.nationalId ?? '');
    const nationalId =
      nationalIdInput === ''
        ? fail('nationalId', 'required', 'Enter the national ID number')
        : /^\d{5,10}$/.test(nationalIdInput)
          ? nationalIdInput
          : fail('nationalId', 'format', 'Enter 5 to 10 digits');

    const designation = optionalText(raw.designation, 100, 'designation', fail);
    const jobGroup = optionalText(raw.jobGroup, 10, 'jobGroup', fail);
    const reportingEntity = optionalText(raw.reportingEntity, 200, 'reportingEntity', fail);
    const employerCode = optional(raw.employerCode, (value) =>
      value.length > 40
        ? fail('employerCode', 'too-long', 'Enter up to 40 characters')
        : EMPLOYER_CODE.test(value)
          ? value
          : fail(
              'employerCode',
              'format',
              'Use only letters, digits, _ or -, starting with a letter or digit',
            ),
    );

    const appointmentDate = optional(raw.appointmentDate, (value) => {
      const iso = parseDate(value);
      if (iso === null) {
        return fail('appointmentDate', 'format', 'Use YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY');
      }
      return iso > today ? fail('appointmentDate', 'future-date', 'Date is in the future') : iso;
    });

    const email = optional(raw.email, (value) => {
      if (value.length > EMAIL_MAX_LENGTH) {
        return fail('email', 'too-long', `Enter up to ${EMAIL_MAX_LENGTH} characters`);
      }
      return normaliseEmail(value) ?? fail('email', 'format', 'Enter a valid email address');
    });

    const phone = optional(raw.phone, (value) => {
      if (value.length > PHONE_MAX_LENGTH) {
        return fail('phone', 'too-long', `Enter up to ${PHONE_MAX_LENGTH} characters`);
      }
      return (
        normalisePhone(value) ??
        fail('phone', 'format', 'Enter a valid phone number, e.g. 0712345678 or +254712345678')
      );
    });

    // Duplicates of rows accepted earlier. Only accepted rows claim their file number and national
    // ID: a row rejected for any reason is not imported, so a corrected copy of it later in the
    // file is not a duplicate.
    const fileNumberKey = personnelFileNumber === null ? undefined : keyOf(personnelFileNumber);
    const fileNumberRow = fileNumberKey === undefined ? undefined : fileNumbers.get(fileNumberKey);
    if (fileNumberRow !== undefined) {
      fail('personnelFileNumber', 'duplicate-in-file', `Same file number as row ${fileNumberRow}`);
    }
    const nationalIdRow = nationalId === null ? undefined : nationalIds.get(nationalId);
    if (nationalIdRow !== undefined) {
      fail('nationalId', 'duplicate-in-file', `Same national ID as row ${nationalIdRow}`);
    }

    if (
      errors.length > 0 ||
      fileNumberKey === undefined ||
      personnelFileNumber === null ||
      fullName === null ||
      nationalId === null
    ) {
      return { status: 'rejected', normalised: null, errors };
    }
    fileNumbers.set(fileNumberKey, rowNumber);
    nationalIds.set(nationalId, rowNumber);
    return {
      status: 'accepted',
      normalised: {
        personnelFileNumber,
        fullName,
        nationalId,
        designation,
        jobGroup,
        reportingEntity,
        employerCode,
        appointmentDate,
        email,
        phone,
      },
      errors: [],
    };
  };
}

const FILE_NUMBER = /^[A-Za-z0-9/.-]+$/;
/** The integration gateway's employer code (its supplier check takes no other). */
const EMPLOYER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Trims and collapses runs of whitespace (including non-breaking spaces) to one space. */
function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function optional<T>(value: string | null | undefined, check: (value: string) => T): T | null {
  const collapsed = collapse(value);
  return collapsed === '' ? null : check(collapsed);
}

function optionalText(
  value: string | null | undefined,
  maxLength: number,
  field: RosterField,
  fail: (field: RosterField, code: RowErrorCode, message: string) => null,
): string | null {
  return optional(value, (collapsed) =>
    collapsed.length > maxLength
      ? fail(field, 'too-long', `Enter up to ${maxLength} characters`)
      : collapsed,
  );
}

/** `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY` (day and month may be one digit) to ISO, or null. */
export function parseDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dayFirst = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(value);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dayFirst
      ? [Number(dayFirst[4]), Number(dayFirst[3]), Number(dayFirst[1])]
      : [NaN, NaN, NaN];
  if (!Number.isInteger(year) || year < 1900) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Today, `YYYY-MM-DD`, in Kenya's time zone. */
export function todayInNairobi(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}
