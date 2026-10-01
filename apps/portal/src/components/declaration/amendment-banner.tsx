import { Icon } from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';

import type { Declaration } from '../../server/declarations/types';
import { DiscardAmendmentButton } from './discard-amendment-dialog';

export const AMENDMENT_BANNER_COPY = {
  text: (version: number) =>
    `You are amending version ${String(version)}. Submit again to file version ${String(version + 1)}, or discard the amendment to keep version ${String(version)}.`,
  badge: (version: number) => `Amending version ${String(version)}`,
} as const;

/** The version an amendment in progress started from; null unless amending. */
export function amendingFrom(
  declaration: Pick<Declaration, 'status' | 'amendingFromVersion' | 'currentVersion'>,
): number | null {
  if (declaration.status !== 'amending') return null;
  return declaration.amendingFromVersion ?? declaration.currentVersion;
}

/** Where the workspace sends the declarant once an amendment is discarded. */
export function useAmendmentDiscarded(fromVersion: number) {
  const navigate = useNavigate();
  return () => navigate({ to: '/declarations', search: { discarded: fromVersion } });
}

/**
 * The banner on every workspace screen while amending (spec 06 FE-4): which version is being
 * amended, what submitting files, and Discard amendment.
 */
export function AmendmentBanner({
  declarationId,
  fromVersion,
}: {
  declarationId: string;
  fromVersion: number;
}) {
  const discarded = useAmendmentDiscarded(fromVersion);
  return (
    <div
      role="note"
      className="flex flex-wrap items-start gap-3 rounded-xl bg-info-subtle px-4 py-3.5 text-info-subtle-foreground"
    >
      <Icon icon={InformationCircleIcon} className="mt-0.5 size-[17px] shrink-0" />
      <p className="min-w-[220px] flex-1 text-sm">{AMENDMENT_BANNER_COPY.text(fromVersion)}</p>
      <DiscardAmendmentButton
        declarationId={declarationId}
        fromVersion={fromVersion}
        variant="secondary"
        onDiscarded={discarded}
      />
    </div>
  );
}
