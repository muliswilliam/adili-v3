import { z } from 'zod';

/** Response of `GET /v1/commissions/{slug}/roster/onboarding-failures` (`OnboardingFailures`). */
export const onboardingFailuresSchema = z.object({
  since: z.iso.datetime().meta({
    description: 'Start of the earliest hour counted: the current hour and the 23 before it',
  }),
  failedAttempts: z.number().int().meta({
    description:
      'Failed onboarding attempts against the Commission since `since`, by anyone: identify answered `no-match` (wrong or unknown identifiers, or an exited record), or a session ended because its codes or resends ran out',
  }),
  hours: z
    .array(
      z.object({
        windowStart: z.iso.datetime(),
        failedAttempts: z.number().int(),
      }),
    )
    .meta({ description: 'Hours with failed attempts, oldest first' }),
});

export type OnboardingFailuresView = z.infer<typeof onboardingFailuresSchema>;
