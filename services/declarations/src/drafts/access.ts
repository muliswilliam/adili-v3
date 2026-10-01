import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import type { PersonContext } from '@adili/data-access';

/**
 * The declarant a drafts route acts for, by the `person_id` claim; 404 for a caller without one
 * (staff), as drafts are nobody else's.
 */
export function personOf(principal: Principal): PersonContext {
  return {
    personId: notFoundIfInvisible(principal.personId),
    subject: principal.subject,
  };
}
