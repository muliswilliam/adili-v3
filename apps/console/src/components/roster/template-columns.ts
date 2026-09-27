/**
 * The nine roster template columns as the wizard's template step lists them. Mirrors the
 * directory's `ROSTER_COLUMNS` (services/directory/src/roster/columns.ts), the single source for
 * the parser and the template file; a test keeps the two in step. Column names stay English
 * identifiers in every UI language.
 */
export interface TemplateColumn {
  name: string;
  required: boolean;
  /** One-line format rule, as in the template's notes. */
  format: string;
  /** The value in the template's sample row. */
  example: string;
}

export const TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
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
  {
    name: 'appointment_date',
    required: false,
    format: 'YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY; not in the future',
    example: '2019-01-07',
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
];

/** The required columns, in template order. */
export const REQUIRED_COLUMNS = TEMPLATE_COLUMNS.filter((column) => column.required).map(
  (column) => column.name,
);
