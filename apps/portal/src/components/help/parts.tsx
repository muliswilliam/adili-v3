import { Button, cn, focusRing, Icon, Tooltip } from '@adili/ui';
import { HelpCircleIcon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { HELP_COPY, type HelpCopy, type HelpLanguage } from '../../help/copy';
import { highlight } from '../../help/highlight';
import type { HelpPassage } from '../../server/declarations/types';

/** Pieces the help pages share (spec 11 FE-3). */

/** The question mark in the page header that opens the help pages. */
export function HelpLink() {
  const label = HELP_COPY.en.open;
  return (
    <Tooltip content={label}>
      <Button asChild variant="ghost" size="icon" className="text-secondary-foreground">
        <Link to="/help" aria-label={label}>
          <Icon icon={HelpCircleIcon} />
        </Link>
      </Button>
    </Tooltip>
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
  language: HelpLanguage;
  copy: HelpCopy;
  onChange: (language: HelpLanguage) => void;
}) {
  return (
    <div
      role="group"
      aria-label={copy.language}
      className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]"
    >
      {(['en', 'sw'] as const).map((code) => (
        <Button
          key={code}
          type="button"
          size="xs"
          variant="ghost"
          lang={code}
          aria-pressed={language === code}
          onClick={() => {
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
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-md px-2 text-[12px] font-semibold whitespace-nowrap [&_svg]:size-3',
        help
          ? 'bg-brand-subtle text-brand-subtle-foreground'
          : 'bg-muted text-secondary-foreground',
      )}
    >
      <Icon icon={help ? HelpCircleIcon : JusticeScale01Icon} />
      {help ? copy.helpTag(issuerCode) : citation}
    </span>
  );
}

/** The searched words marked in a snippet. */
export function Snippet({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-[3px] bg-highlight px-px text-inherit">
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
  language: HelpLanguage;
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
          'grid gap-1.5 rounded-[14px] bg-card px-4 py-3.5 text-foreground shadow-card transition-shadow hover:shadow-[0_0_0_1px_var(--color-border),0_6px_18px_-10px_rgb(0_0_0/0.2)]',
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
