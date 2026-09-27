import type { DirectoryError } from '../../server/directory/client';
import { messages as m } from './messages';

/** The toast after a resend, and whether the card must refetch to show what changed. */
export interface ResendOutcome {
  title: string;
  destructive: boolean;
  /** The officer is no longer what the card shows (activated, replaced or gone). */
  refetch: boolean;
}

/** How the officer card reports a resend the directory accepted (null) or refused. */
export function resendOutcome(error: DirectoryError | null, email: string): ResendOutcome {
  if (error === null) {
    return { title: m.invitationResentToast(email), destructive: false, refetch: false };
  }
  const failed = (title: string, refetch = false) => ({ title, destructive: true, refetch });
  if (error.kind !== 'problem') return failed(m.resendError);
  const { problem } = error;
  if (problem.type === 'reporting-officer-activated') return failed(m.resendActivated, true);
  if (problem.type === 'reporting-officer-account-missing') return failed(m.resendAccountMissing);
  if (problem.status === 404) return failed(m.resendNoOfficer, true);
  if (problem.status === 403) return failed(m.resendForbidden);
  return failed(m.resendError);
}
