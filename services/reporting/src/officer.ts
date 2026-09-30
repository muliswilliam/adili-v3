import type { Principal } from '@adili/api-kit';

/** reporting.yaml `Officer`: who reviewed, confirmed, wrote, approved or pushed, by Keycloak id. */
export interface Officer {
  subject: string;
  name: string;
}

/** The caller as an officer; a token without a name shows its subject. */
export function officerOf(principal: Principal): Officer {
  return { subject: principal.subject, name: principal.name ?? principal.subject };
}

/** An officer from their stored columns: null while nobody has acted; no name shows the subject. */
export function storedOfficer(subject: string | null, name: string | null): Officer | null {
  return subject === null ? null : { subject, name: name ?? subject };
}
