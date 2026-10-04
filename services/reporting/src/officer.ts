import type { Principal } from '@adili/api-kit';
import { z } from 'zod';

import type { Conforms } from './conforms.js';

/** reporting.yaml `Officer`: who reviewed, confirmed, wrote, approved or pushed, by Keycloak id. */
export interface Officer {
  subject: string;
  name: string;
}

export const officerSchema = z
  .object({
    subject: z.string().meta({ description: 'Keycloak subject' }),
    name: z.string().meta({ description: 'Display name; the subject when the token had none' }),
  })
  .meta({ description: 'Who reviewed, confirmed, wrote, approved or pushed' });
true satisfies Conforms<Officer, typeof officerSchema>;

/** The caller as an officer; a token without a name shows its subject. */
export function officerOf(principal: Principal): Officer {
  return { subject: principal.subject, name: principal.name ?? principal.subject };
}

/** An officer from their stored columns: null while nobody has acted; no name shows the subject. */
export function storedOfficer(subject: string | null, name: string | null): Officer | null {
  return subject === null ? null : { subject, name: name ?? subject };
}
