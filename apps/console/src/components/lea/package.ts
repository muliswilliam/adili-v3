import { PACKAGE_PREPARING_FOR_MS, unissuedPackageState, useToast } from '@adili/ui';
import { useState } from 'react';

import type { LeaRequest } from '../../server/access/types';
import { getLeaPackageLink } from '../../server/lea-requests';
import { downloadFrom } from '../download';
import { goToSignIn } from '../sign-in-redirect';
import { useNowAt } from '../use-now-at';
import { messages as m } from './messages';

/** Where the package of the officer's request stands, as the list and the request page show it. */
export type PackageState =
  | { kind: 'none' }
  /** Granted moments ago: the workflow renders, watermarks and signs it. */
  | { kind: 'preparing' }
  /** Granted long ago and still nothing: no package (nothing to disclose, or issuing failed). */
  | { kind: 'missing' }
  | { kind: 'ready'; documentId: string; until: string; issuedAt: string; downloads: number }
  | { kind: 'closed'; until: string; issuedAt: string; downloads: number };

export function packageState(
  request: Pick<LeaRequest, 'status' | 'decision' | 'package'>,
  now: number,
): PackageState {
  if (request.status !== 'granted' || !request.decision) return { kind: 'none' };
  const pkg = request.package;
  // The shared rule: preparing for an hour after the grant, then no package.
  if (!pkg) return { kind: unissuedPackageState(request.decision.decidedAt, now) };
  const base = { until: pkg.downloadExpiresAt, issuedAt: pkg.issuedAt, downloads: pkg.downloads };
  return Date.parse(pkg.downloadExpiresAt) <= now
    ? { kind: 'closed', ...base }
    : { kind: 'ready', documentId: pkg.documentId, ...base };
}

/**
 * `packageState` read against the loader's `now`, moving on by itself an hour after a grant whose
 * package has not come, so "Preparing" turns into "No package has been issued" without a reload.
 */
export function usePackageState(
  request: Pick<LeaRequest, 'status' | 'decision' | 'package'>,
  serverNow: string,
): PackageState {
  const turnsAt =
    request.status === 'granted' && request.decision && !request.package
      ? Date.parse(request.decision.decidedAt) + PACKAGE_PREPARING_FOR_MS
      : null;
  return packageState(request, useNowAt(Date.parse(serverNow), turnsAt));
}

/**
 * Downloads a package: asks documents for a fresh short-lived link as the signed-in officer, then
 * hands it to the browser. A closed window or a failure is said in a toast; `onDone` reloads
 * the page so the count of downloads (and a closed window) show.
 */
export function usePackageDownload(onDone: () => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (documentId: string) => {
    setBusy(documentId);
    const result = await getLeaPackageLink({ data: { documentId } }).catch(() => null);
    setBusy(null);
    if (result?.ok) {
      downloadFrom(result.data.downloadUrl);
      onDone();
      return;
    }
    if (result?.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    if (result?.error.kind === 'window-closed') {
      toast({ title: m.windowClosedToast, urgency: 'assertive' });
      onDone();
      return;
    }
    toast({ title: m.downloadFailed, urgency: 'assertive' });
  };
  return { busy, download };
}
