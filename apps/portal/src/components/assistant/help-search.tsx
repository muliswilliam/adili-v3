import { Alert, AlertDescription, Icon, Input, Skeleton, Spinner } from '@adili/ui';
import {
  HelpCircleIcon,
  JusticeScale01Icon,
  Search01Icon,
  WifiDisconnected02Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useId, useRef, useState } from 'react';

import type { AskCopy, AskLanguage } from '../../assistant/copy';
import { searchAssistantHelp } from '../../server/assistant';
import type { HelpPassage } from '../../server/declarations/types';

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
}: {
  copy: AskCopy;
  language: AskLanguage;
  sectionKey: string | null;
  initialQuery: string;
  /** What to search for before anything is typed: the section's name. */
  sectionQuery: string;
  onAskAgain: () => void;
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
          <button
            type="button"
            onClick={onAskAgain}
            className="cursor-pointer text-sm font-semibold underline underline-offset-2"
          >
            {copy.askAgain}
          </button>
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
      <section id={resultsId} aria-live="polite" aria-busy={search.status === 'searching'}>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {search.status === 'done' && typed
            ? copy.results(search.passages.length)
            : copy.forSection}
          {search.status === 'searching' ? <Spinner className="size-3" /> : null}
        </h3>
        <Results search={search} copy={copy} />
      </section>
    </div>
  );
}

function Results({ search, copy }: { search: Search; copy: AskCopy }) {
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
        <li
          key={passage.id}
          lang={passage.language}
          className="grid justify-items-start gap-1.5 rounded-item bg-card px-3 py-2.5 shadow-card"
        >
          <span className="inline-flex h-[22px] items-center gap-[5px] rounded-md bg-muted px-2 text-[12px] font-medium text-secondary-foreground [&_svg]:size-3">
            <Icon icon={passage.source === 'help' ? HelpCircleIcon : JusticeScale01Icon} />
            {passage.citation}
          </span>
          <b className="text-sm font-semibold">{passage.title}</b>
          <p className="line-clamp-3 text-[13px] leading-[1.45] text-secondary-foreground">
            {passage.snippet}
          </p>
        </li>
      ))}
    </ul>
  );
}
