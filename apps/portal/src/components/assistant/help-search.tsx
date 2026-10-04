import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  cn,
  focusRing,
  Icon,
  Input,
  Skeleton,
  Spinner,
} from '@adili/ui';
import {
  HelpCircleIcon,
  JusticeScale01Icon,
  Search01Icon,
  WifiDisconnected02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';

import type { AskCopy } from '../../assistant/copy';
import type { Language } from '../../language';
import { searchAssistantHelp } from '../../server/assistant';
import { getDeclarationSummary } from '../../server/declarations';
import type { CompletenessIssue, HelpPassage } from '../../server/declarations/types';
import { issueText, readSummaryDocument } from '../declaration/summary';

type Search =
  { status: 'searching' } | { status: 'done'; passages: HelpPassage[] } | { status: 'failed' };

/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 250;

/**
 * Ask Adili without AI (spec 11 S12, "works without AI"): a notice that answers are unavailable
 * and a search over the Act, the Regulations and help articles (the help endpoint is deterministic
 * and works when the ai-gateway does not). Starts with the question that could not be answered,
 * or with the passages for the section when there is none.
 */
export function HelpSearch({
  copy,
  language,
  sectionKey,
  initialQuery,
  sectionQuery,
  onAskAgain,
  declarationId,
  onFix,
}: {
  copy: AskCopy;
  language: Language;
  sectionKey: string | null;
  initialQuery: string;
  /** What to search for before anything is typed: the section's name. */
  sectionQuery: string;
  onAskAgain: () => void;
  /** The draft whose residuals to list under the results; none on the dashboard. */
  declarationId: string | null;
  /** Opens a residual's field. */
  onFix: (step: string, field: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [found, setFound] = useState<{ key: string; search: Search } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const typed = query.trim().length >= 2;
  const q = typed ? query.trim() : sectionQuery;
  const searchKey = `${q}|${language}|${sectionKey ?? ''}`;
  const search: Search = found?.key === searchKey ? found.search : { status: 'searching' };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      searchAssistantHelp({ data: { q, language, sectionKey } })
        .then((result) => {
          if (!current) return;
          if (result.status === 'unauthenticated') {
            window.location.reload();
            return;
          }
          setFound({
            key: searchKey,
            search:
              result.status === 'ok'
                ? { status: 'done', passages: result.passages }
                : { status: 'failed' },
          });
        })
        .catch(() => {
          if (current) setFound({ key: searchKey, search: { status: 'failed' } });
        });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q, language, sectionKey, searchKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      <Alert variant="warning" role="status">
        <Icon icon={WifiDisconnected02Icon} />
        <AlertDescription className="grid justify-items-start gap-1">
          <span>{copy.unavailable}</span>
          <Button
            type="button"
            variant="link"
            onClick={onAskAgain}
            className="text-sm font-semibold text-inherit"
          >
            {copy.askAgain}
          </Button>
        </AlertDescription>
      </Alert>
      <div className="relative">
        <Icon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={copy.search}
          aria-label={copy.search}
          aria-controls={resultsId}
          autoComplete="off"
          maxLength={200}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="pl-9"
        />
      </div>
      {/* Only the count is read as results come; the list is there to browse. */}
      <p role="status" className="sr-only">
        {search.status === 'done' ? copy.results(search.passages.length) : ''}
      </p>
      <section id={resultsId} aria-busy={search.status === 'searching'}>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {search.status === 'done' && typed
            ? copy.results(search.passages.length)
            : copy.forSection}
          {search.status === 'searching' ? <Spinner className="size-3" /> : null}
        </h3>
        <Results search={search} copy={copy} language={language} />
      </section>
      {declarationId ? (
        <StillMissing declarationId={declarationId} copy={copy} onFix={onFix} />
      ) : null}
    </div>
  );
}

/** How many residuals the panel lists; the summary lists them all. */
const MISSING_LIMIT = 5;

interface Residual {
  issue: CompletenessIssue;
  text: string;
}

/**
 * What the completeness check still reports for the draft, in its deterministic words (the
 * summary's), each with Fix to open the field: the no-AI half of "flags incomplete sections".
 * Nothing is shown while it loads, when it cannot be read, or when nothing is missing.
 */
function StillMissing({
  declarationId,
  copy,
  onFix,
}: {
  declarationId: string;
  copy: AskCopy;
  onFix: (step: string, field: string) => void;
}) {
  const [residuals, setResiduals] = useState<Residual[] | null>(null);
  const headingId = useId();

  useEffect(() => {
    let current = true;
    getDeclarationSummary({ data: { declarationId } })
      .then((result) => {
        if (!current || result.status !== 'ok') return;
        const document = readSummaryDocument(result.summary.document);
        setResiduals(
          result.summary.blocking.map((issue) => ({ issue, text: issueText(issue, document) })),
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [declarationId]);

  if (!residuals || residuals.length === 0) return null;
  const hidden = residuals.length - MISSING_LIMIT;
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <h3
        id={headingId}
        className="text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase"
      >
        {copy.missing(residuals.length)}
      </h3>
      <ul lang="en" className="grid gap-1.5 text-[13.5px]">
        {residuals.slice(0, MISSING_LIMIT).map(({ issue, text }) => (
          <li
            key={`${issue.sectionKey}${issue.path}${issue.code}`}
            className="flex items-start justify-between gap-3 rounded-item bg-card px-3 py-2 shadow-card"
          >
            <span>{text}</span>
            <Button
              type="button"
              variant="link"
              aria-label={`${copy.fix}: ${text}`}
              onClick={() => {
                onFix(issue.sectionKey, issue.path);
              }}
              className="shrink-0 text-sm font-semibold"
            >
              {copy.fix}
            </Button>
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className="text-[13px] text-muted-foreground">{copy.more(hidden)}</p> : null}
    </section>
  );
}

function Results({
  search,
  copy,
  language,
}: {
  search: Search;
  copy: AskCopy;
  language: Language;
}) {
  if (search.status === 'failed') {
    return <p className="text-sm text-muted-foreground">{copy.searchFailed}</p>;
  }
  if (search.status !== 'done') {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (search.passages.length === 0) {
    return <p className="text-sm text-muted-foreground">{copy.noHits}</p>;
  }
  return (
    <ul className="grid gap-2">
      {search.passages.map((passage) => (
        <li key={passage.id} lang={passage.language}>
          {/* Each hit opens its help page, where the whole passage is. */}
          <Link
            to="/help/$passageId"
            params={{ passageId: passage.id }}
            search={{ lang: language }}
            className={cn(
              focusRing,
              'grid justify-items-start gap-1.5 rounded-item bg-card px-3 py-2.5 text-foreground no-underline shadow-card hover:bg-background',
            )}
          >
            <Badge size="tag">
              <Icon icon={passage.source === 'help' ? HelpCircleIcon : JusticeScale01Icon} />
              {passage.citation}
            </Badge>
            <b className="text-sm font-semibold">{passage.title}</b>
            <p className="line-clamp-3 text-[13px] leading-[1.45] text-secondary-foreground">
              {passage.snippet}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
