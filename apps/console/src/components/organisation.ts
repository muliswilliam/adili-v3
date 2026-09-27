/** Tenant key of platform staff (EACC's platform team), which is not a Commission. */
export const PLATFORM_TENANT = 'platform';

/** The organisation a staff account belongs to, as the dashboard shows it (spec 01 story 28). */
export type Organisation =
  /** The account's Commission, by its display name. */
  | { kind: 'commission'; key: string; name: string }
  /** Platform staff: no Commission to look up. */
  | { kind: 'platform'; key: string }
  /** The Commission could not be looked up; only its tenant key is known. */
  | { kind: 'key-only'; key: string }
  | { kind: 'none' };

/**
 * Resolves the viewer's organisation from their tenant key and, for a Commission, the display
 * name the directory returned (or null when the lookup failed or found nothing).
 */
export function organisationOf(tenant: string | null, commissionName: string | null): Organisation {
  if (!tenant) return { kind: 'none' };
  if (tenant === PLATFORM_TENANT) return { kind: 'platform', key: tenant };
  return commissionName
    ? { kind: 'commission', key: tenant, name: commissionName }
    : { kind: 'key-only', key: tenant };
}
