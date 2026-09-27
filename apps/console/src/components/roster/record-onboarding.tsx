import { DescriptionItem, formatDateTime, Icon, OfficerReference } from '@adili/ui';
import { SquareLock02Icon } from '@hugeicons/core-free-icons';

import { IdentityMismatchBadge } from './identity-mismatch';

/**
 * The spec 03 onboarding fields of a roster record (`RosterRecord` in the directory contract).
 * The contract draft does not carry `ofr`, `onboardedAt` or `identityMismatchAt` yet; these are
 * the names spec 03 gives them (S25), so map the contract's record onto this until it does.
 */
export interface RosterRecordOnboarding {
  state: 'not_onboarded' | 'onboarded' | 'exited';
  /** Officer reference, once the declarant has onboarded. */
  ofr: string | null;
  /** ISO date-time. */
  onboardedAt: string | null;
  /** ISO date-time of the failed identity check, while the record is flagged. */
  identityMismatchAt: string | null;
}

/** Full name and national ID can no longer be changed by an import once the declarant onboarded. */
export function isIdentityLocked(record: Pick<RosterRecordOnboarding, 'state'>): boolean {
  return record.state === 'onboarded';
}

/** Shown after the full name and national ID of an onboarded declarant's record. */
export function LockedChip() {
  return (
    <span
      title="Locked because the declarant has onboarded"
      className="ml-1.5 inline-flex items-center gap-1 align-[1px] text-xs font-medium text-muted-foreground [&_svg]:size-3"
    >
      <Icon icon={SquareLock02Icon} strokeWidth={2} />
      Locked
      <span className="sr-only"> because the declarant has onboarded</span>
    </span>
  );
}

/**
 * Rows for the record detail's Status list: officer reference (with copy) and onboarded date for
 * an onboarded declarant, and the identity check when it failed. Renders nothing otherwise. Goes
 * inside a `DescriptionList`, under a `ToastProvider` for the copy confirmation.
 */
export function OnboardingStatusItems({ record }: { record: RosterRecordOnboarding }) {
  const onboarded = record.state === 'onboarded';
  return (
    <>
      {onboarded && record.ofr ? (
        <DescriptionItem term="Officer reference" className="items-center">
          <OfficerReference value={record.ofr} />
        </DescriptionItem>
      ) : null}
      {onboarded && record.onboardedAt ? (
        <DescriptionItem term="Onboarded on">{formatDateTime(record.onboardedAt)}</DescriptionItem>
      ) : null}
      {record.identityMismatchAt ? (
        <DescriptionItem term="Identity check">
          <IdentityMismatchBadge />
        </DescriptionItem>
      ) : null}
    </>
  );
}
