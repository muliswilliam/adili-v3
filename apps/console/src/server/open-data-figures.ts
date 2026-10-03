/**
 * The figures of the open-data release's Commission tables (#491 `tables.ts`), in the order the
 * Commission open-data preview lists them. Shared by the loader's row check, the page and the
 * mock; not a `.server` module, so the page may import it.
 */

/** `compliance-by-commission`'s figures, in the order the page lists them. */
export const COMPLIANCE_FIGURES = [
  'determinationsCompliant',
  'determinationsNonCompliant',
  'determinationsFurtherAction',
  'clarificationsIssued',
  'clarificationsResolved',
  'actionsNoticeToComply',
  'actionsWarning',
  'actionsSalaryStoppage',
  'actionsDisciplinaryReferral',
  'referrals',
] as const;

/** `access-requests`' figures. */
export const ACCESS_REQUEST_FIGURES = ['received', 'granted', 'declined'] as const;
