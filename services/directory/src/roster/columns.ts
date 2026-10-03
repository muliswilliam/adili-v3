/**
 * The roster template columns (spec 02's nine, the employer code, and spec 05b's work station and
 * marital status, which pre-fill the declaration's bio): the single source for the roster file
 * parser (header matching, validation limits) and the template generator (headers, sample row,
 * notes sheet, cell formats). Order is the template's column order.
 */
export const ROSTER_COLUMNS = [
  {
    name: 'personnel_file_number',
    field: 'personnelFileNumber',
    required: true,
    format: 'Up to 30 letters, digits, /, - or .; unique in the file',
    example: 'TSC/004512',
    note: "Your Commission's identifier for the officer. Declarants onboard with it, and later imports update the officer with the same number. Keep leading zeros.",
    textCell: true,
  },
  {
    name: 'full_name',
    field: 'fullName',
    required: true,
    format: '2 to 200 characters',
    example: 'Achieng Mary Otieno',
    note: 'As on the national ID. Cannot change through imports once the officer has onboarded.',
    textCell: false,
  },
  {
    name: 'national_id',
    field: 'nationalId',
    required: true,
    format: '5 to 10 digits; unique in the file',
    example: '23456789',
    note: 'National ID number, digits only (spaces are removed). Cannot change through imports once the officer has onboarded.',
    textCell: true,
  },
  {
    name: 'designation',
    field: 'designation',
    required: false,
    format: 'Up to 100 characters',
    example: 'Senior Teacher',
    note: 'Job title.',
    textCell: false,
  },
  {
    name: 'job_group',
    field: 'jobGroup',
    required: false,
    format: 'Up to 10 characters',
    example: 'C3',
    note: 'Job group or grade.',
    textCell: false,
  },
  {
    name: 'reporting_entity',
    field: 'reportingEntity',
    required: false,
    format: 'Up to 200 characters',
    example: 'Moi Girls High School, Eldoret',
    note: 'School, ministry, department or station. New names are created as reporting entities on import.',
    textCell: false,
  },
  {
    name: 'work_station',
    field: 'workStation',
    required: false,
    format: 'Up to 100 characters',
    example: 'Eldoret',
    note: 'Where the public officer works: office, building or town. Pre-filled in their declaration, where they can change it.',
    textCell: false,
  },
  {
    name: 'appointment_date',
    field: 'appointmentDate',
    required: false,
    format: 'YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY; not in the future',
    example: '2019-01-07',
    note: 'Date of appointment to the current office. Excel date cells are accepted.',
    textCell: false,
  },
  {
    name: 'marital_status',
    field: 'maritalStatus',
    required: false,
    format: 'single, married, separated, divorced or widowed (any case)',
    example: 'married',
    note: "Pre-filled in the public officer's declaration, where they can change it.",
    textCell: false,
  },
  {
    name: 'email',
    field: 'email',
    required: false,
    format: 'Email address, up to 254 characters',
    example: 'mary.otieno@example.go.ke',
    note: 'Where the officer receives onboarding codes.',
    textCell: false,
  },
  {
    name: 'phone',
    field: 'phone',
    required: false,
    format: 'Kenyan mobile (07…, 01…) or international (+…)',
    example: '0712345678',
    note: 'Where the officer receives onboarding codes by SMS. Stored in international format (+254…).',
    textCell: true,
  },
  {
    name: 'employer_code',
    field: 'employerCode',
    required: false,
    format: 'Up to 40 letters, digits, _ or -, starting with a letter or digit',
    example: 'TSC',
    note: "The code your HR and payroll systems use for the officer's employer. Review checks the officer's companies against that employer's supplier list.",
    textCell: true,
  },
] as const satisfies readonly RosterColumn[];

export interface RosterColumn {
  /** Header in the template and in uploaded files (matched case- and whitespace-insensitively). */
  name: string;
  /** Property in normalised rows, API batches and row errors. */
  field: string;
  required: boolean;
  /** One-line format rule, shown in the template notes and the console's column table. */
  format: string;
  /** Value in the template's sample row. */
  example: string;
  /** Guidance for the HR colleague filling the template. */
  note: string;
  /** Formatted as text in the XLSX template so Excel keeps leading zeros. */
  textCell: boolean;
}

export type RosterColumnName = (typeof ROSTER_COLUMNS)[number]['name'];
export type RosterField = (typeof ROSTER_COLUMNS)[number]['field'];
