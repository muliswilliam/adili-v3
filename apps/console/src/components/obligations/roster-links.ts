import { linkOptions } from '@tanstack/react-router';

import type { RecordsSearch } from '../roster/records-query';

/** The records list's filter for declarants who have not onboarded. */
const NOT_ONBOARDED: RecordsSearch = { state: 'not_onboarded' };

/**
 * "View roster" on the not-onboarded callout (S23): the viewer's own roster records, filtered to
 * declarants who have not onboarded.
 */
export function notOnboardedRosterLink() {
  return linkOptions({ to: '/roster/records', search: NOT_ONBOARDED });
}

/** The same for a platform admin looking at a Commission: its records, not onboarded only. */
export function commissionNotOnboardedRosterLink(slug: string) {
  return linkOptions({
    to: '/commissions/$slug/records',
    params: { slug },
    search: NOT_ONBOARDED,
  });
}
