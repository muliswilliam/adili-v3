import { HelpCircleIcon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, useId, useState } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Button } from './button';
import { Icon } from './icon';

/** Where a cited passage comes from: the Act, the Regulations, the Administrative Mechanisms or a help article. */
export type CitationSource = 'act' | 'regs' | 'am' | 'help';

/** A passage an answer cites: the fields of the assistant contract's `HelpPassage`. */
export interface Citation {
  id: string;
  source: CitationSource;
  /** What the chip shows, e.g. "Act s.31(4)", "AM 24" or "Help: Joint assets". */
  citation: string;
  title: string;
  /** The passage text shown when the chip is expanded. */
  snippet: string;
  /** The passage's language, set on it so screen readers read it in the right voice. */
  language: 'en' | 'sw';
}

export interface CitationMessages {
  /** Names the row of chips. */
  listLabel: string;
  /** Printed after the passage title: "Approximate values · Administrative Mechanisms". */
  sourceNames: Record<CitationSource, string>;
  /** The link under an expanded passage to its help page. */
  readPassage: string;
}

const DEFAULT_MESSAGES: CitationMessages = {
  listLabel: 'Sources',
  sourceNames: {
    act: 'Conflict of Interest Act, 2025',
    regs: 'Conflict of Interest Regulations, 2026',
    am: 'Administrative Mechanisms',
    help: 'Adili help',
  },
  readPassage: 'Read in help',
};

export type CitationChipProps = Omit<ComponentProps<'button'>, 'children'> & {
  citation: Citation;
  expanded?: boolean;
};

/**
 * A button showing the citation's text ("Act s.31(4)"), with a scales icon for the law and a
 * question mark for help. It carries `aria-expanded`; `CitationList` opens the passage under it.
 */
export function CitationChip({
  citation,
  expanded = false,
  className,
  ...props
}: CitationChipProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-source={citation.source}
      {...props}
      className={cn(
        focusRing,
        'inline-flex h-[26px] max-w-full cursor-pointer items-center gap-[5px] rounded-md bg-muted px-[9px] text-[12.5px] font-medium text-secondary-foreground hover:bg-input hover:text-foreground aria-expanded:bg-input aria-expanded:text-foreground aria-expanded:shadow-[inset_0_0_0_1px_var(--color-border)] [&_svg]:size-3 [&_svg]:shrink-0',
        className,
      )}
    >
      <Icon icon={citation.source === 'help' ? HelpCircleIcon : JusticeScale01Icon} />
      <span className="truncate">{citation.citation}</span>
    </button>
  );
}

export type CitationListProps = Omit<ComponentProps<'div'>, 'children'> & {
  citations: readonly Citation[];
  /** Opens a passage's help page; the link is left out without it. */
  onReadPassage?: (citation: Citation) => void;
  messages?: Partial<CitationMessages>;
};

/**
 * The chips under an answer. Pressing one opens its passage underneath (title, source and text)
 * and closes any other; pressing it again closes it.
 */
export function CitationList({
  citations,
  onReadPassage,
  messages,
  className,
  ...props
}: CitationListProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const passageId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = citations.find((citation) => citation.id === openId);

  if (citations.length === 0) return null;

  return (
    <div className={cn('grid gap-2', className)} {...props}>
      <ul aria-label={copy.listLabel} className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <li key={citation.id} className="max-w-full">
            <CitationChip
              citation={citation}
              expanded={citation.id === openId}
              aria-controls={citation.id === openId ? passageId : undefined}
              onClick={() => {
                setOpenId((current) => (current === citation.id ? null : citation.id));
              }}
            />
          </li>
        ))}
      </ul>
      {open ? (
        <div
          id={passageId}
          lang={open.language}
          className="grid justify-items-start gap-1.5 rounded-r-lg border-l-3 border-input bg-background px-3 py-2.5 text-[13px] text-secondary-foreground"
        >
          <p>
            <span className="font-semibold text-foreground">{open.title}</span>{' '}
            <span className="text-muted-foreground">· {copy.sourceNames[open.source]}</span>
          </p>
          <p>{open.snippet}</p>
          {onReadPassage ? (
            <Button
              variant="link"
              className="text-[13px]"
              onClick={() => {
                onReadPassage(open);
              }}
            >
              {copy.readPassage}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
