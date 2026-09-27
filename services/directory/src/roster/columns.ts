/**
 * The roster file's columns (spec 02): the single definition that the roster template is
 * generated from and that the roster file parser maps headers against, so the two cannot drift.
 * Header matching is case- and whitespace-insensitive on `name`; column order does not matter.
 */
export interface RosterColumn {
  /** Header in the file; stays this English identifier whatever the UI language. */
  name: string;
  /** A missing required header fails the import before any row is read. */
  required: boolean;
  /** How to fill the column, as the template's Notes sheet tells HR staff. */
  format: string;
  /** The template's sample row value. */
  example: string;
  /**
   * Values are identifiers, not numbers: the XLSX template formats the column as text so Excel
   * keeps leading zeros, and the parser reads numeric cells by their displayed text.
   */
  text: boolean;
}

export const ROSTER_COLUMNS = [
  {
    name: 'personnel_file_number',
    required: true,
    format:
      "Your Commission's file number for the officer. 1 to 30 letters, digits, '/', '-' or '.'. Unique in the file.",
    example: '000123',
    text: true,
  },
  {
    name: 'full_name',
    required: true,
    format: 'Full name as on the national ID. 2 to 200 characters.',
    example: 'Achieng Mary Otieno',
    text: false,
  },
  {
    name: 'national_id',
    required: true,
    format: 'National ID number, 5 to 10 digits. Unique in the file.',
    example: '23456789',
    text: false,
  },
  {
    name: 'designation',
    required: false,
    format: 'Job title. Up to 100 characters.',
    example: 'Senior Accountant',
    text: false,
  },
  {
    name: 'job_group',
    required: false,
    format: 'Job group or grade. Up to 10 characters.',
    example: 'M',
    text: false,
  },
  {
    name: 'reporting_entity',
    required: false,
    format:
      'School, ministry, department or office the officer works in. Up to 200 characters. New names are added to your reporting entities.',
    example: 'State Department for Public Service',
    text: false,
  },
  {
    name: 'appointment_date',
    required: false,
    format:
      'Date of appointment: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or an Excel date. Not in the future.',
    example: '2019-07-01',
    text: false,
  },
  {
    name: 'email',
    required: false,
    format: "The officer's email address. Used to send onboarding codes.",
    example: 'achieng.otieno@example.go.ke',
    text: false,
  },
  {
    name: 'phone',
    required: false,
    format: 'Mobile number, e.g. 0712345678 or +254712345678. Kenyan numbers may leave out +254.',
    example: '0712345678',
    text: true,
  },
] as const satisfies readonly RosterColumn[];

export type RosterColumnName = (typeof ROSTER_COLUMNS)[number]['name'];
