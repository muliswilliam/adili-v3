import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Icon,
  type Scope,
  scopeSectionLabels,
  Spinner,
} from '@adili/ui';
import { Alert02Icon, AlertCircleIcon } from '@hugeicons/core-free-icons';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import type { AccessProblem, ScopePreview, ScopePreviewYear } from '../../../server/access/types';
import type { ServiceResult } from '../../../server/service-call';
import { messages as m } from './messages';

/** Counts what a scope holds of the declarant's declarations (decision 1): never content. */
export type PreviewScope = (scope: Scope) => Promise<ServiceResult<ScopePreview, AccessProblem>>;

/** Where the preview of the scope in the form stands. */
export type PreviewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; preview: ScopePreview }
  | { state: 'failed' };

/** How long the form waits after the officer stops ticking before it counts. */
const SETTLE_MS = 300;

const keyOf = (scope: Scope) => JSON.stringify(scope);

/** A scope's count, once answered: the preview, or that it could not be counted. */
type Counted = { ok: true; preview: ScopePreview } | { ok: false };

/**
 * The preview of `scope` (null: none to count, e.g. a denial or an incomplete selection): counted
 * once the selection settles, each scope once (answers are kept by scope, so a late answer for an
 * earlier selection never shows for the current one). `retry` counts it again after a failure.
 */
export function useScopePreview(
  scope: Scope | null,
  load: PreviewScope,
): PreviewState & { retry: () => void } {
  const [counted, setCounted] = useState<ReadonlyMap<string, Counted>>(new Map());
  const key = scope ? keyOf(scope) : null;
  const answer = key === null ? undefined : counted.get(key);

  // The caller's function may be a new one each render; only the scope decides a count.
  const count = useEffectEvent((key: string, scope: Scope) => {
    void load(scope)
      .catch((): ServiceResult<ScopePreview, AccessProblem> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }))
      .then((result) => {
        setCounted((current) =>
          new Map(current).set(key, result.ok ? { ok: true, preview: result.data } : { ok: false }),
        );
      });
  });

  const waiting = key !== null && answer === undefined;
  useEffect(() => {
    if (!waiting || scope === null) return;
    const timer = setTimeout(() => {
      count(key, scope);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
    // `scope` is read through its key: a new object with the same choices counts nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, waiting]);

  const retry = useCallback(() => {
    if (key === null) return;
    setCounted((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, [key]);

  const state: PreviewState =
    key === null
      ? { state: 'idle' }
      : answer === undefined
        ? { state: 'loading' }
        : answer.ok
          ? { state: 'ready', preview: answer.preview }
          : { state: 'failed' };
  return { ...state, retry };
}

/** `Income 3 entries`, `Personal details 2 persons`: what one section of a year holds. */
function sectionCounts(year: ScopePreviewYear): string[] {
  return Object.entries(year.sections).map(([section, count]) =>
    m.previewSection(
      scopeSectionLabels[section as keyof typeof scopeSectionLabels],
      count,
      section === 'bio',
    ),
  );
}

function householdCounts(year: ScopePreviewYear): string[] {
  return [
    ...(year.spouses === null ? [] : [m.previewSpouses(year.spouses)]),
    ...(year.children === null ? [] : [m.previewChildren(year.children)]),
    ...(year.clarifications === null ? [] : [m.previewClarifications(year.clarifications)]),
  ];
}

/**
 * What the scope the officer is about to decide on holds (decision 1), beside the form: per
 * declaration year, how many declarations, entries per section, household members and
 * clarifications a grant would disclose, in counts only. When it holds nothing, a warning says a
 * grant issues the nil letter instead of a package.
 */
export function ScopePreviewPanel({
  preview,
  heading,
}: {
  preview: PreviewState & { retry: () => void };
  heading: string;
}) {
  if (preview.state === 'idle') return null;
  return (
    <section
      aria-label={heading}
      aria-busy={preview.state === 'loading' || undefined}
      className="grid gap-2.5 rounded-lg border bg-muted/40 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-medium">{heading}</h3>
        <span className="text-[13px] text-muted-foreground">{m.previewCountsOnly}</span>
      </div>
      <div aria-live="polite" className="grid gap-2.5">
        {preview.state === 'loading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {m.previewLoading}
          </p>
        ) : null}
        {preview.state === 'failed' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm">
              <Icon icon={AlertCircleIcon} className="size-4 shrink-0 text-destructive" />
              {m.previewFailed}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={preview.retry}>
              {m.previewRetry}
            </Button>
          </div>
        ) : null}
        {preview.state === 'ready' ? <PreviewCounts preview={preview.preview} /> : null}
      </div>
    </section>
  );
}

function PreviewCounts({ preview }: { preview: ScopePreview }) {
  if (preview.empty) {
    return (
      <Alert variant="warning">
        <Icon icon={Alert02Icon} />
        <AlertTitle>{m.previewEmptyTitle}</AlertTitle>
        <AlertDescription>
          {preview.declarantOnboarded ? m.previewEmpty : m.previewNoAccount}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      <p className="text-sm font-medium">
        {m.previewTotal(preview.declarations, preview.clarifications)}
      </p>
      <ul className="grid gap-2 text-sm">
        {preview.years.map((year) => (
          <li key={year.year} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3">
            <span className="font-mono text-[13px] leading-5 text-muted-foreground">
              {year.year}
            </span>
            {year.declarations === 0 ? (
              <span className="text-muted-foreground">{m.previewNoDeclaration}</span>
            ) : (
              <span className="min-w-0">
                <span className="font-medium">{m.previewDeclarations(year.declarations)}</span>
                <span className="block text-[13px] leading-5 text-secondary-foreground">
                  {[...sectionCounts(year), ...householdCounts(year)].join(' · ')}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
