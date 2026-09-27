import { z } from 'zod';

export const IDENTIFY_ERRORS = {
  commission: 'Choose your Responsible Commission.',
  personnelFileNumber: 'Enter your personnel file number as it appears on your payslip.',
  nationalId: 'Enter your national ID number (5 to 10 digits).',
} as const;

/** The Identify form, checked in the browser and again in the server function. */
export const identifySchema = z.object({
  commission: z.string().min(1, IDENTIFY_ERRORS.commission),
  personnelFileNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/.-]{1,30}$/, IDENTIFY_ERRORS.personnelFileNumber),
  nationalId: z
    .string()
    .transform((value) => value.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{5,10}$/, IDENTIFY_ERRORS.nationalId)),
});

export type IdentifyInput = z.input<typeof identifySchema>;
export type IdentifyFields = keyof IdentifyInput;
export type IdentifyFieldErrors = Partial<Record<IdentifyFields, string>>;

/** Field errors for the form, or null when it is valid. */
export function identifyErrors(input: IdentifyInput): IdentifyFieldErrors | null {
  const result = identifySchema.safeParse(input);
  if (result.success) return null;
  const errors: IdentifyFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as IdentifyFields;
    errors[field] ??= issue.message;
  }
  return errors;
}
