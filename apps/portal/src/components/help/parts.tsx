import { Badge, Button, cn, focusRing, Icon, Tooltip } from '@adili/ui';
import { HelpCircleIcon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { HELP_COPY, type HelpCopy } from '../../help/copy';
import type { Language } from '../../language';
import { highlight } from '../../help/highlight';
import type { HelpPassage } from '../../server/declarations/types';
import { SignOutButton } from '../sign-out-button';

/** Pieces the help pages share (spec 11 FE-3), and the header link that opens them. */

/** A card that lifts on hover: the help topics and passage rows. */
export const liftOnHover = 'transition-shadow hover:shadow-card-hover';

/**
 * The question mark in the page header that opens the help pages, in the language the help is
 * read in (English outside them).
 */
export function HelpLink({ language = 'en' }: { language?: Language }) {
  const label = HELP_COPY[language].open;
  return (
    <Tooltip content={label}>
      <Button asChild variant="ghost" size="icon" className="text-secondary-foreground">
        <Link
          to="/help"
          search={{ lang: language === 'en' ? undefined : language }}
          aria-label={label}
        >
          <Icon icon={HelpCircleIcon} />
        </Link>
      </Button>
    </Tooltip>
  );
}

/** The signed-in declarant's header actions: help, and signing out. */
export function DeclarantHeaderActions({ language }: { language?: Language }) {
  return (
    <>
      <HelpLink language={language} />
      <SignOutButton />
    </>
  );
}

/**
 * English or Kiswahili for the page's text (the help pages keep their own language: the rest of
 * the portal is English).
 */
export function LanguageSwitch({
  language,
  copy,
  onChange,
}: {
  language: Language;
  copy: HelpCopy;
  onChange: (language: Language) => void;
}) {
  // Said once the page is in the language picked, not on arrival.
  const [switched, setSwitched] = useState(false);
  return (
    <div
      role="group"
      aria-label={copy.language}
      className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]"
    >
      <span role="status" className="sr-only">
        {switched ? copy.languageChanged : ''}
      </span>
      {(['en', 'sw'] as const).map((code) => (
        <Button
          key={code}
          type="button"
          size="xs"
          variant="ghost"
          lang={code}
          aria-pressed={language === code}
          onClick={() => {
            if (code === language) return;
            setSwitched(true);
            onChange(code);
          }}
          className="h-[30px] px-3 text-[13.5px] font-medium text-secondary-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-control"
        >
          {code === 'en' ? 'English' : 'Kiswahili'}
        </Button>
      ))}
    </div>
  );
}

/**
 * Where a passage comes from: the citation for the law ("Act s.31(4)"), "Help" (or "TSC help")
 * for an article.
 */
export function PassageTag({
  source,
  citation,
  issuerCode = null,
  copy,
}: {
  source: HelpPassage['source'];
  citation: string;
  issuerCode?: string | null;
  copy: HelpCopy;
}) {
  const help = source === 'help';
  return (
    <Badge variant={help ? 'brand' : 'default'} size="tag">
      <Icon icon={help ? HelpCircleIcon : JusticeScale01Icon} />
      {help ? copy.helpTag(issuerCode) : citation}
    </Badge>
  );
}

/** The searched words marked in a snippet. */
export function Snippet({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-xs bg-highlight px-px text-inherit">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** A passage in a list: its tag, title and snippet, opening its page. */
export function PassageRow({
  passage,
  query,
  language,
}: {
  passage: HelpPassage;
  /** Marked in the snippet; empty when browsing. */
  query: string;
  language: Language;
}) {
  const copy = HELP_COPY[language];
  const englishOnly = language === 'sw' && passage.language === 'en';
  return (
    <li lang={passage.language}>
      <Link
        to="/help/$passageId"
        params={{ passageId: passage.id }}
        search={{ lang: language }}
        className={cn(
          focusRing,
          liftOnHover,
          'grid gap-1.5 rounded-item bg-card px-4 py-3.5 text-foreground shadow-card',
        )}
      >
        <span className="flex flex-wrap items-center gap-2">
          <PassageTag source={passage.source} citation={passage.citation} copy={copy} />
          <b className="font-semibold">{passage.title}</b>
          {englishOnly ? (
            <span lang={language} className="text-[13px] text-muted-foreground">
              {copy.englishOnly}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">
          <Snippet text={passage.snippet} query={query} />
        </span>
      </Link>
    </li>
  );
}
