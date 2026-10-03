import {
  Alert,
  AlertDescription,
  Button,
  Card,
  cn,
  EmptyState,
  focusRing,
  formatDate,
  Icon,
  IconTile,
  Input,
  SiteFooter,
  SiteHeader,
  textLink,
  TooltipProvider,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BankIcon,
  Cancel01Icon,
  CreditCardIcon,
  Globe02Icon,
  Home01Icon,
  JusticeScale01Icon,
  RefreshIcon,
  Search01Icon,
  SentIcon,
  UserGroupIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { HELP_COPY } from '../../help/copy';
import type { Language } from '../../language';
import { HELP_TOPICS, type TopicKey, topicOf } from '../../help/topics';
import type { HelpPassage, HelpPassageDetail } from '../../server/declarations/types';
import {
  DeclarantHeaderActions,
  LanguageSwitch,
  liftOnHover,
  PassageRow,
  PassageTag,
} from './parts';

/**
 * The help pages (spec 11 FE-3): the Act, the Regulations, the Administrative Mechanisms and
 * help articles, browsed by topic or searched in English or Kiswahili through the help search
 * endpoint, and each passage on its own page with its citation. Deterministic: no AI.
 */

const TOPIC_ICONS = {
  start: Home01Icon,
  people: UserGroupIcon,
  income: Wallet01Icon,
  assets: BankIcon,
  liabilities: CreditCardIcon,
  changes: RefreshIcon,
  submit: SentIcon,
  law: JusticeScale01Icon,
} satisfies Record<TopicKey, unknown>;

/** How long typing pauses before the address (and so the search) follows it. */
const DEBOUNCE_MS = 250;

export function HelpShell({ language, children }: { language: Language; children: ReactNode }) {
  return (
    <TooltipProvider>
      <SiteHeader actions={<DeclarantHeaderActions language={language} />} />
      <main
        lang={language}
        className="mx-auto w-full max-w-[820px] flex-1 px-4 pt-8 pb-16 sm:px-7 sm:pt-10"
      >
        <div className="grid gap-[18px]">{children}</div>
      </main>
      <SiteFooter />
    </TooltipProvider>
  );
}

/** What the help home shows below the search box. */
export type HelpListing =
  | { kind: 'topics' }
  | { kind: 'search'; query: string; passages: HelpPassage[] | null }
  | { kind: 'topic'; topic: TopicKey; passages: HelpPassage[] | null };

export interface HelpHomeProps {
  language: Language;
  /** What is in the address's `q`; the box follows the declarant's typing ahead of it. */
  query: string;
  /** `passages` null: the search could not be run. */
  listing: HelpListing;
  onQuery: (query: string) => void;
  onTopic: (topic: TopicKey | null) => void;
  onLanguage: (language: Language) => void;
}

export function HelpHome({
  language,
  query,
  listing,
  onQuery,
  onTopic,
  onLanguage,
}: HelpHomeProps) {
  const copy = HELP_COPY[language];
  const [typed, setTyped] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  // The address changed elsewhere (a topic, the back button): the box shows it.
  const [seen, setSeen] = useState(query);
  if (seen !== query) {
    setSeen(query);
    if (typed.trim() !== query) setTyped(query);
  }

  useEffect(() => {
    const next = typed.trim();
    if (next === query) return;
    const timer = setTimeout(() => {
      onQuery(next);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed, query, onQuery]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{copy.title}</h1>
        <LanguageSwitch language={language} copy={copy} onChange={onLanguage} />
      </div>
      <div className="relative">
        <Icon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          type="search"
          value={typed}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.search}
          aria-controls={resultsId}
          autoComplete="off"
          maxLength={200}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          className="h-[50px] pr-12 pl-11 text-[15.5px] [&::-webkit-search-cancel-button]:hidden"
        />
        {typed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={copy.clear}
            onClick={() => {
              setTyped('');
              onQuery('');
              inputRef.current?.focus();
            }}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
          >
            <Icon icon={Cancel01Icon} />
          </Button>
        ) : null}
      </div>
      <div id={resultsId} className="grid gap-[18px]">
        <Listing listing={listing} language={language} onTopic={onTopic} />
      </div>
    </>
  );
}

function Listing({
  listing,
  language,
  onTopic,
}: {
  listing: HelpListing;
  language: Language;
  onTopic: (topic: TopicKey | null) => void;
}) {
  const copy = HELP_COPY[language];
  if (listing.kind === 'topics') {
    return (
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {HELP_TOPICS.map(({ key }) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => {
                onTopic(key);
              }}
              className={cn(
                focusRing,
                liftOnHover,
                'flex h-full w-full cursor-pointer items-center gap-3.5 rounded-item bg-card px-4 py-3.5 text-left shadow-card',
              )}
            >
              <IconTile size="md">
                <Icon icon={TOPIC_ICONS[key]} />
              </IconTile>
              <span className="grid min-w-0 flex-1">
                <b className="font-semibold">{copy.topics[key].name}</b>
                <span className="text-sm text-muted-foreground">{copy.topics[key].about}</span>
              </span>
              <Icon icon={ArrowRight01Icon} className="size-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    );
  }
  if (listing.passages === null) return <Unavailable message={copy.unavailable} />;

  const list = (
    <ul className="grid gap-2">
      {listing.passages.map((passage) => (
        <PassageRow
          key={passage.id}
          passage={passage}
          query={listing.kind === 'search' ? listing.query : ''}
          language={language}
        />
      ))}
    </ul>
  );

  if (listing.kind === 'topic') {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onTopic(null);
          }}
          className="-ml-2.5 justify-self-start"
        >
          <Icon icon={ArrowLeft01Icon} />
          {copy.allTopics}
        </Button>
        <h2 className="text-[17px] font-semibold">{copy.topics[listing.topic].name}</h2>
        {listing.passages.length > 0 ? list : <NoResults language={language} />}
      </>
    );
  }

  return (
    <>
      {/* Read as results come; the empty state shows its own words. */}
      <p
        role="status"
        className={listing.passages.length > 0 ? 'text-sm text-muted-foreground' : 'sr-only'}
      >
        {listing.passages.length > 0 ? copy.results(listing.passages.length) : copy.noResults}
      </p>
      {listing.passages.length > 0 ? list : <NoResults language={language} />}
    </>
  );
}

function NoResults({ language }: { language: Language }) {
  const copy = HELP_COPY[language];
  return (
    <Card>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={copy.noResults}
        description={copy.noResultsHint}
      />
    </Card>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <Alert variant="warning" role="status">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export interface HelpArticleProps {
  language: Language;
  passage: HelpPassageDetail;
  /** Other passages on the article's topic; null when they could not be read. */
  related: HelpPassage[] | null;
  onLanguage: (language: Language) => void;
}

/** One passage or article, whole, with its source, citation and when it took effect. */
export function HelpArticle({ language, passage, related, onLanguage }: HelpArticleProps) {
  const copy = HELP_COPY[language];
  const headingId = useId();
  const topic = topicOf(passage.tags);
  const statutory = passage.source !== 'help';
  const source = passage.commission?.name ?? copy.sourceNames[passage.source];
  const meta = [source, copy.inForceFrom(formatDate(passage.effectiveFrom))];
  if (statutory) meta.push(copy.statutory);

  return (
    <>
      <nav aria-label={copy.breadcrumb}>
        <ol className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
          <li>
            <Link
              to="/help"
              search={{ lang: language }}
              className={cn(textLink, 'font-medium text-secondary-foreground')}
            >
              {copy.title}
            </Link>
          </li>
          <li aria-hidden="true">
            <Icon icon={ArrowRight01Icon} className="size-3.5" />
          </li>
          <li>
            <Link
              to="/help"
              search={{ topic, lang: language }}
              className={cn(textLink, 'font-medium text-secondary-foreground')}
            >
              {copy.topics[topic].name}
            </Link>
          </li>
        </ol>
      </nav>
      <Card asChild className="gap-3.5">
        <article aria-labelledby={headingId}>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <PassageTag
              source={passage.source}
              citation={passage.citation}
              issuerCode={passage.commission?.issuerCode ?? null}
              copy={copy}
            />
            <LanguageSwitch language={language} copy={copy} onChange={onLanguage} />
          </div>
          <div className="grid gap-1.5">
            <h1
              id={headingId}
              lang={passage.language}
              className="text-2xl leading-tight font-semibold tracking-tight"
            >
              {passage.title}
            </h1>
            <p className="text-[13px] text-muted-foreground">{meta.join(' · ')}</p>
          </div>
          {language === 'sw' && passage.language === 'en' ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-muted px-4 py-3 text-sm text-secondary-foreground">
              <Icon icon={Globe02Icon} className="size-4 shrink-0" />
              <span>{copy.notYetInSwahili}</span>
            </div>
          ) : null}
          {statutory ? (
            <blockquote
              lang={passage.language}
              className="rounded-r-xl border-l-3 border-input bg-background px-4 py-3.5 text-[15px] leading-[1.65] whitespace-pre-line"
            >
              {passage.text}
            </blockquote>
          ) : (
            <p lang={passage.language} className="text-[15.5px] leading-[1.65] whitespace-pre-line">
              {passage.text}
            </p>
          )}
        </article>
      </Card>
      {related && related.length > 0 ? (
        <section aria-labelledby={`${headingId}-related`} className="grid gap-2">
          <h2 id={`${headingId}-related`} className="text-[17px] font-semibold">
            {copy.related}
          </h2>
          <ul className="grid gap-2">
            {related.map((other) => (
              <PassageRow key={other.id} passage={other} query="" language={language} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** The passage is not in force, not visible to the declarant, or not there at all. */
export function HelpArticleNotFound({ language }: { language: Language }) {
  const copy = HELP_COPY[language];
  return (
    <Card>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={copy.notFound}
        description={
          <>
            {copy.notFoundHint}{' '}
            <Link to="/help" search={{ lang: language }} className={textLink}>
              {copy.title}
            </Link>
          </>
        }
      />
    </Card>
  );
}

export function HelpUnavailable({ language }: { language: Language }) {
  return <Unavailable message={HELP_COPY[language].unavailable} />;
}
