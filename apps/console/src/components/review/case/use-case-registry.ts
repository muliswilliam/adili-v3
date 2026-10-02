import type { DeclarationV1 } from '@adili/forms';
import { useToast } from '@adili/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CASE_COPY, REGISTRY_COPY } from '../../../review-case/messages';
import {
  cooldownMinutes,
  cooldownText,
  minutesWords,
  recheckAvailableAt,
  recheckLanded,
  type RegistryLayout,
  registryLayout,
  summaryView,
} from '../../../review-case/registry';
import {
  getCaseRegistry,
  getCaseRegistryStatus,
  recheckCaseRegistries,
} from '../../../server/review-case';
import type { CaseRegistryView, CaseViewDetail } from '../../../server/review-case.server';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../../server/service-call';
import { goToSignIn } from '../../sign-in-redirect';
import { failureText } from '../assignment';

/**
 * The cooldown words ("Re-checked recently. Try again in {m} minutes.") until `availableAt`,
 * updated as the minutes go by; null from then on, or when there is no cooldown. Starts from
 * `initialNow` (the page's time, as the server rendered it) so the first render matches it.
 */
export function useCooldown(availableAt: number | null, initialNow: number): string | null {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    if (availableAt === null) return;
    const tick = () => {
      setNow(Date.now());
    };
    tick();
    const left = availableAt - Date.now();
    if (left <= 0) return;
    const every = window.setInterval(tick, COOLDOWN_TICK_MS);
    const end = window.setTimeout(tick, left + 50);
    return () => {
      window.clearInterval(every);
      window.clearTimeout(end);
    };
  }, [availableAt]);
  return cooldownText(availableAt, now);
}

/** How often the cooldown's minutes are worked out again. */
const COOLDOWN_TICK_MS = 15_000;

/**
 * Waits between reads of the registry status after a re-check: the lookups take seconds (more
 * when a registry is retried), so early reads are close together and later ones further apart.
 * About a minute and a half in all, after which the tab says the re-check is still running.
 */
export const RECHECK_POLL_MS = [
  1500, 2000, 2000, 3000, 3000, 5000, 5000, 5000, 8000, 8000, 10_000, 10_000, 15_000, 15_000,
];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CaseRegistry {
  /** What the Registry tab shows; null until its records were read (or failed to be). */
  layout: RegistryLayout | null;
  /** The records could not be read: the tab shows the last check's statuses. */
  failed: boolean;
  /** Try again is reading the records. */
  retrying: boolean;
  retry: () => void;
  /** A re-check is running. */
  checking: boolean;
  /**
   * When the next re-check is accepted (epoch ms; null when one is): ten minutes after the case's
   * last re-check, or later when review refused one (429) since the page loaded.
   */
  availableAt: number | null;
  /** The end of a refusal's wait (429) seen on this page, for the tab to say so; null before. */
  refusedUntil: number | null;
  /** The Re-check confirmation is open. */
  confirming: boolean;
  setConfirming: (open: boolean) => void;
  /** Starts a re-check; the error to show in the dialog, or null when it closed. */
  recheck: () => Promise<string | null>;
}

/**
 * The case's Registry tab state (spec 07b): its records, read when the tab first opens (an
 * audited read of its own) and again on Try again or once a re-check has landed, and the
 * re-check itself: start it, then poll the case's unaudited registry status until the new check
 * is stored.
 */
export function useCaseRegistry({
  load,
  open,
  refresh,
}: {
  load: {
    detail: CaseViewDetail;
    /** The declaration as filed, for the people and items; null when it could not be read. */
    document: DeclarationV1 | null;
  };
  /** The Registry tab is open. */
  open: boolean;
  /** Reloads the case (its flags and registry summary). */
  refresh: () => Promise<void>;
}): CaseRegistry {
  const { detail, document } = load;
  const caseId = detail.case.id;
  const { toast } = useToast();
  // Null until read; `failed` shows the last statuses.
  const [registry, setRegistry] = useState<{ view: CaseRegistryView | null; failed: boolean }>({
    view: null,
    failed: false,
  });
  const [retrying, setRetrying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const requested = useRef(false);
  const mounted = useRef(true);
  // A function, so the checks after each await are not narrowed away.
  const isMounted = () => mounted.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function readRegistry(): Promise<ServiceResult<CaseRegistryView>> {
    return getCaseRegistry({ data: { caseId } }).catch(
      (): ServiceResult<CaseRegistryView> => SERVICE_UNAVAILABLE,
    );
  }

  async function loadRegistry() {
    requested.current = true;
    const result = await readRegistry();
    if (!isMounted()) return;
    if (!result.ok && result.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    setRegistry(result.ok ? { view: result.data, failed: false } : { view: null, failed: true });
  }

  useEffect(() => {
    if (!open || requested.current) return;
    void loadRegistry();
    // Read once, when the tab first opens; later reads follow a re-check or Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Polls when the case's latest check was stored (an unaudited read) until the re-check's has
   * landed, then reads the records once (the audited read) and shows them.
   */
  async function awaitRecheck(before: string | null) {
    for (const delay of RECHECK_POLL_MS) {
      await wait(delay);
      if (!isMounted()) return;
      const status = await getCaseRegistryStatus({ data: { caseId } }).catch(
        () => SERVICE_UNAVAILABLE,
      );
      if (!isMounted()) return;
      // The session ended: polling on would only fail; sign in again, back to this case.
      if (!status.ok && status.error.kind === 'unauthenticated') {
        goToSignIn();
        return;
      }
      if (status.ok && recheckLanded(before, status.data.checkedAt)) {
        await loadRegistry();
        if (!isMounted()) return;
        setChecking(false);
        toast({ title: REGISTRY_COPY.recheck.done });
        await refresh();
        return;
      }
    }
    setChecking(false);
    toast({ title: REGISTRY_COPY.recheck.slow });
    await refresh();
  }

  async function recheck(): Promise<string | null> {
    const before = registry.view?.checkedAt ?? detail.registry.checkedAt;
    const result = await recheckCaseRegistries({ data: { caseId } });
    if (result.ok) {
      setConfirming(false);
      setRefusedUntil(null);
      setChecking(true);
      void awaitRecheck(before);
      return null;
    }
    if (result.refusal === null) return failureText(result.error);
    setConfirming(false);
    if (result.refusal.kind === 'cooldown') {
      const seconds = result.refusal.retryAfterSeconds;
      setRefusedUntil(Date.now() + seconds * 1000);
      toast({
        title: REGISTRY_COPY.recheck.cooldown(minutesWords(cooldownMinutes(seconds))),
        urgency: 'assertive',
      });
      return null;
    }
    // Someone else holds the case now, or it was determined: the page is out of date.
    toast({
      title: result.refusal.kind === 'closed' ? REGISTRY_COPY.recheck.closed : CASE_COPY.stale,
      urgency: 'assertive',
    });
    await refresh();
    return null;
  }

  const layout = useMemo(() => {
    if (registry.view) return registryLayout(registry.view, detail.flags, true);
    if (!registry.failed) return null;
    return registryLayout(
      summaryView(detail.registry, document, detail.flags, detail.case.declarantName),
      detail.flags,
      false,
    );
  }, [registry, detail.flags, detail.registry, document, detail.case.declarantName]);

  return {
    layout,
    failed: registry.failed,
    retrying,
    retry: () => {
      setRetrying(true);
      void loadRegistry().finally(() => {
        setRetrying(false);
      });
    },
    checking,
    availableAt: recheckAvailableAt(detail.registry, refusedUntil),
    refusedUntil,
    confirming,
    setConfirming,
    recheck,
  };
}
