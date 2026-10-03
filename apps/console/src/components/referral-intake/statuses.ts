import type { IcmsStatus } from '../../server/reporting/types';

/** reporting.yaml `IcmsStatus`, in the order the intake filters them. */
export const ICMS_STATUSES = [
  'not-pushed',
  'pushed',
  'registered',
  'push-failed',
] as const satisfies readonly IcmsStatus[];
