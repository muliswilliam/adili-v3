import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { commissionsSchema } from '../commissions/schema.js';
import { lawEnforcementSchema } from '../law-enforcement/schema.js';
import { onboardingSchema } from '../onboarding/schema.js';
import { personsSchema } from '../persons/schema.js';
import { apiCredentialSchema } from '../roster/api-credential/schema.js';
import { rosterSchema } from '../roster/schema.js';

/** Drizzle schema of the directory database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  ...numberingSchema,
  ...commissionsSchema,
  ...apiCredentialSchema,
  ...rosterSchema,
  ...personsSchema,
  ...lawEnforcementSchema,
  ...onboardingSchema,
};

export type DirectorySchema = typeof schema;

export * from '../commissions/schema.js';
export * from '../law-enforcement/schema.js';
export * from '../onboarding/schema.js';
export * from '../persons/schema.js';
export * from '../roster/api-credential/schema.js';
export * from '../roster/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
