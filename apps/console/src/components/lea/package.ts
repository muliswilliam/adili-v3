import { grantPackageStatus, useToast } from '@adili/ui';
import { useState } from 'react';

import type { LeaRequest } from '../../server/access/types';
import { getLeaPackageLink } from '../../server/lea-requests';
import { downloadFrom } from '../download';
import { goToSignIn } from '../sign-in-redirect';
import { useNowAt } from '../use-now-at';
import { messages as m } from './messages';

/** What the officer was issued: the access package, or the nil letter (decision 1). */
export type PackageKind = NonNullable<LeaRequest['package']>['kind'];

/** Where the package of the officer's request stands, as the list and the request page show it. */
export type PackageState =
  | { kind: 'none' }
  /** The workflow renders, watermarks and signs it (or the nil letter). */
  | { kind: 'preparing' }
  /** Issuing it failed after its retries. */
  | { kind: 'failed' }
  | {
      kind: 'ready';
      document: PackageKind;
      documentId: string;
      until: string;
      issuedAt: string;
      downloads: number;
    }
  | { kind: 'closed'; document: PackageKind; until: string; issuedAt: string; downloads: number };

export function packageState(
  request: Pick<LeaRequest, 'status' | 'decision' | 'package' | 'packageFailedAt'>,
  now: number,
): PackageState {
  if (request.status !== 'granted' || !request.decision) return { kind: 'none' };
  const pkg = request.package;
  if (!pkg) {
    // The shared rule: preparing until issued, unless the backend says issuing failed.
    return {
      kind: grantPackageStatus(null, request.packageFailedAt) === 'failed' ? 'failed' : 'preparing',
    };
  }
  const base = {
    document: pkg.kind,
    until: pkg.downloadExpiresAt,
    issuedAt: pkg.issuedAt,
    downloads: pkg.downloads,
  };
  return Date.parse(pkg.downloadExpiresAt) <= now
    ? { kind: 'closed', ...base }
    : { kind: 'ready', documentId: pkg.documentId, ...base };
}

/**
 * `packageState` read against the loader's `now`, moving on by itself when the download window
 * closes, so the page says so without a reload.
 */
export function usePackageState(
  request: Pick<LeaRequest, 'status' | 'decision' | 'package' | 'packageFailedAt'>,
  serverNow: string,
): PackageState {
  const turnsAt = request.package ? Date.parse(request.package.downloadExpiresAt) : null;
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
