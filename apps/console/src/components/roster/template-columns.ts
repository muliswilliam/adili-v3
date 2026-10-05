import type { components } from '../../server/directory/api.gen';

/**
 * The twelve roster template columns as the wizard's template step lists them. Mirrors the
 * directory's column definitions, the single source for its parser and the template file. The
 * names are checked against the directory contract at compile time (below); the rules and
 * examples copy the template's notes. Column names stay English identifiers in every UI language.
 */

/** A template column name, as the directory contract enumerates them. */
export type RosterColumnName = components['schemas']['ColumnMapping']['matched'][number]['field'];

export interface TemplateColumn {
  name: RosterColumnName;
  required: boolean;
  /** One-line format rule, as in the template's notes. */
  format: string;
  /** The value in the template's sample row. */
  example: string;
}

export const TEMPLATE_COLUMNS = [
  {
    name: 'personnel_file_number',
    required: true,
    format: 'Up to 30 letters, digits, /, - or .; unique in the file',
    example: 'TSC/004512',
  },
  {
    name: 'full_name',
    required: true,
    format: '2 to 200 characters',
    example: 'Achieng Mary Otieno',
  },
  {
    name: 'national_id',
    required: true,
    format: '5 to 10 digits; unique in the file',
    example: '23456789',
  },
  {
    name: 'designation',
    required: false,
    format: 'Up to 100 characters',
    example: 'Senior Teacher',
  },
  { name: 'job_group', required: false, format: 'Up to 10 characters', example: 'C3' },
  {
    name: 'reporting_entity',
    required: false,
    format: 'Up to 200 characters',
    example: 'Moi Girls High School, Eldoret',
  },
  { name: 'work_station', required: false, format: 'Up to 100 characters', example: 'Eldoret' },
  {
    name: 'appointment_date',
    required: false,
    format: 'YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY; not in the future',
    example: '2019-01-07',
  },
  {
    name: 'marital_status',
    required: false,
    format: 'single, married, separated, divorced or widowed (any case)',
    example: 'married',
  },
  {
    name: 'email',
    required: false,
    format: 'Email address, up to 254 characters',
    example: 'mary.otieno@example.go.ke',
  },
  {
    name: 'phone',
    required: false,
    format: 'Kenyan mobile (07…, 01…) or international (+…)',
    example: '0712345678',
  },
  {
    name: 'employer_code',
    required: false,
    format: 'Up to 40 letters, digits, _ or -, starting with a letter or digit',
    example: 'TSC',
  },
] as const satisfies readonly TemplateColumn[];

/**
 * Compile-time drift check: a column the contract names but this list lacks is a type error
 * here. (A name the contract does not know already fails `TemplateColumn['name']`.)
 */
type Unlisted = Exclude<RosterColumnName, (typeof TEMPLATE_COLUMNS)[number]['name']>;
export const EVERY_CONTRACT_COLUMN_LISTED: [Unlisted] extends [never] ? true : Unlisted = true;

/** The required columns, in template order. */
export const REQUIRED_COLUMNS = TEMPLATE_COLUMNS.filter((column) => column.required).map(
  (column) => column.name,
);
