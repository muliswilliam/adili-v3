import { useToast } from '@adili/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { COPIES_COPY as COPY } from '../../access/history-copy';
import type { CertifiedCopy } from '../../server/access/types';
import {
  getMyCertifiedCopy,
  getMyCertifiedCopyDownload,
  requestMyCertifiedCopy,
} from '../../server/certified-copies';
import { usePoll } from '../declaration/use-poll';
import { downloadFrom } from '../download';
import { signInAgain } from '../sign-in';

/** How often a copy being prepared is checked on. */
export const COPY_POLL_MS = 1500;
/** How many times, about a minute; a copy still being prepared then is followed after a reload. */
export const COPY_POLLS = 40;

/** The version a copy is of. */
export interface CopyTarget {
  /** The Commission the declaration was filed with (its slug). */
  commission: string;
  declarationId: string;
  version: number;
}

export const versionKey = (declarationId: string, version: number) =>
  `${declarationId}:${String(version)}`;

/** Where a version's certified copy stands, for its button. */
export type CopyState =
  | { step: 'none' }
  /** Being asked for, or being prepared: "Preparing…". */
  | { step: 'preparing' }
  | { step: 'issued'; copy: CertifiedCopy & { documentId: string } }
  | { step: 'failed' };

/**
 * Certified copies of the declarant's submitted versions (spec 10 FE-4, S13): Request certified
 * copy, then "Preparing…" while the access service has it issued (checked on every
 * `COPY_POLL_MS`, one read at a time, up to `COPY_POLLS` reads), then Download. A copy that
 * could not be prepared offers Try again, which asks again (the service tries a failed copy
 * again). Copies already asked for (`initial`, or later `remember`) start where they stand, and
 * one still being prepared is followed too.
 */
export function useCertifiedCopies(initial: CertifiedCopy[] = []) {
  const { toast } = useToast();
  const [copies, setCopies] = useState(() => byVersion(initial));
  const [asking, setAsking] = useState<ReadonlySet<string>>(new Set());
  const [downloading, setDownloading] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const store = useCallback((copy: CertifiedCopy) => {
    setCopies((current) =>
      new Map(current).set(versionKey(copy.declarationId, copy.version), copy),
    );
  }, []);

  const remember = useCallback((known: CertifiedCopy[]) => {
    setCopies((current) => {
      const next = new Map(current);
      for (const [key, copy] of byVersion(known)) if (!next.has(key)) next.set(key, copy);
      return next;
    });
  }, []);

  // Follow every copy still being prepared until it is issued or fails.
  const pendingIds = [...copies.values()]
    .filter((copy) => copy.status === 'pending')
    .map((copy) => copy.id)
    .sort()
    .join(',');
  usePoll({
    pollKey: pendingIds || null,
    read: () =>
      Promise.all(
        pendingIds
          .split(',')
          .map((copyId) => getMyCertifiedCopy({ data: { copyId } }).catch(() => null)),
      ),
    onRead: (results) => {
      for (const result of results ?? []) {
        if (result?.status === 'unauthenticated') {
          signInAgain();
          return true;
        }
        if (result?.status !== 'ok' || result.copy.status === 'pending') continue;
        store(result.copy);
        if (result.copy.status === 'issued') toast({ title: COPY.ready });
      }
      // A copy settled changes the ids followed, which starts over; nothing else is done.
      return false;
    },
    onGiveUp: () => undefined,
    intervalMs: COPY_POLL_MS,
    limit: COPY_POLLS,
  });

  function stateOf(declarationId: string, version: number): CopyState {
    const key = versionKey(declarationId, version);
    if (asking.has(key)) return { step: 'preparing' };
    const copy = copies.get(key);
    if (!copy) return { step: 'none' };
    if (copy.status === 'pending') return { step: 'preparing' };
    if (copy.status === 'issued' && copy.documentId !== null) {
      return { step: 'issued', copy: { ...copy, documentId: copy.documentId } };
    }
    return copy.status === 'failed' ? { step: 'failed' } : { step: 'preparing' };
  }

  async function request(target: CopyTarget) {
    const key = versionKey(target.declarationId, target.version);
    setAsking((current) => new Set(current).add(key));
    const result = await requestMyCertifiedCopy({
      data: { ...target, idempotencyKey: crypto.randomUUID() },
    }).catch(() => null);
    if (!mounted.current) return;
    setAsking((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    if (result?.status === 'unauthenticated') {
      signInAgain();
      return;
    }
    if (result?.status === 'ok') {
      store(result.copy);
      if (result.copy.status === 'issued') toast({ title: COPY.ready });
      return;
    }
    toast({ title: COPY.requestFailed, urgency: 'assertive' });
  }

  async function download(documentId: string) {
    setDownloading(documentId);
    const link = await getMyCertifiedCopyDownload({ data: { documentId } }).catch(() => null);
    if (!mounted.current) return;
    setDownloading(null);
    if (link?.status === 'unauthenticated') {
      signInAgain();
      return;
    }
    if (link?.status === 'ok') downloadFrom(link.downloadUrl);
    else toast({ title: COPY.downloadFailed, urgency: 'assertive' });
  }

  return { stateOf, request, download, downloading, remember };
}

export type CertifiedCopies = ReturnType<typeof useCertifiedCopies>;

/** The latest copy of each version (the service keeps one per version, latest asked first). */
function byVersion(copies: CertifiedCopy[]): Map<string, CertifiedCopy> {
  const map = new Map<string, CertifiedCopy>();
  for (const copy of copies) {
    const key = versionKey(copy.declarationId, copy.version);
    if (!map.has(key)) map.set(key, copy);
  }
  return map;
}
