import { z } from 'zod';

/** `AssignReportingOfficer.phone` in the contract: E.164, normalised by the caller. */
export const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

/**
 * Body of `PUT /v1/commissions/{slug}/reporting-officer` (`AssignReportingOfficer` in the
 * contract). The email is compared and stored in lower case, as Keycloak stores usernames.
 */
export const assignReportingOfficerBody = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, "Enter the officer's full name (2 to 120 characters)")
    .max(120, "Enter the officer's full name (2 to 120 characters)"),
  email: z
    .string()
    .trim()
    .max(254, 'Enter a valid email address')
    .pipe(z.email('Enter a valid email address'))
    .transform((email) => email.toLowerCase())
    .meta({ format: 'email', maxLength: 254 }),
  phone: z
    .string()
    .regex(E164_PATTERN, 'Enter the phone number in E.164 format, e.g. +254712345678')
    .meta({ description: 'E.164', examples: ['+254712345678'] }),
});

export type AssignReportingOfficerBody = z.infer<typeof assignReportingOfficerBody>;
