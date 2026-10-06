import {
  BankIcon,
  Briefcase01Icon,
  Car01Icon,
  File01Icon,
  IdIcon,
  Location01Icon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { formatDate } from '../lib/format-date';
import { Badge } from './badge';
import { Icon, type IconProps } from './icon';
import { Tooltip } from './tooltip';

/**
 * Where a declared item's details can come from: a government registry, or a document the
 * declarant read in. IPRS (the civil register) offers the declarant's own particulars.
 */
export const SOURCE_KINDS = ['kra', 'ntsa', 'brs', 'ardhisasa', 'iprs', 'document'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Display names. Registry names are not translated. */
export const SOURCE_NAMES: Record<SourceKind, string> = {
  kra: 'KRA',
  ntsa: 'NTSA',
  brs: 'BRS',
  ardhisasa: 'ArdhiSasa',
  iprs: 'IPRS',
  document: 'Document',
};

export const SOURCE_ICONS: Record<SourceKind, IconProps['icon']> = {
  kra: BankIcon,
  ntsa: Car01Icon,
  brs: Briefcase01Icon,
  ardhisasa: Location01Icon,
  iprs: IdIcon,
  document: File01Icon,
};

export interface ItemSourceDetails {
  kind: SourceKind;
  /** When the registry answered or the document was read, as an ISO timestamp. */
  at: string;
  /**
   * What the source identifies: a registration, parcel or company number, or for a document its
   * file name and page (e.g. "logbook-KCB782M.pdf, page 1").
   */
  reference?: string;
}

/**
 * The sentence a SourceBadge shows in its tooltip: "From NTSA, 26 Sep 2026 · KCA 123A", or
 * "Read from logbook-KCB782M.pdf, page 1, 26 Sep 2026" for a document.
 */
export function describeSource({ kind, at, reference }: ItemSourceDetails): string {
  const date = formatDate(at);
  if (kind === 'document') {
    return reference ? `Read from ${reference}, ${date}` : `Read from a document, ${date}`;
  }
  return `From ${SOURCE_NAMES[kind]}, ${date}${reference ? ` · ${reference}` : ''}`;
}

export type SourceBadgeProps = Omit<ComponentProps<'span'>, 'children'> &
  ItemSourceDetails & {
    /** Replaces the tooltip sentence. Defaults to `describeSource`. */
    describe?: (source: ItemSourceDetails) => string;
    /** Replaces the badge text. Defaults to the source's name. */
    name?: string;
    /** Read before the sentence by screen readers. Defaults to "Source". */
    labelPrefix?: string;
  };

/**
 * Marks an item whose details came from a registry (blue) or a document (purple, as it was
 * read with AI). The badge shows the source's icon and name; it takes keyboard focus and its
 * tooltip (and accessible name, "Source: From NTSA, 26 Sep 2026 · KCA 123A") adds the date and
 * the identifier. Needs no TooltipProvider, but shares one when mounted.
 */
export function SourceBadge({
  kind,
  at,
  reference,
  describe = describeSource,
  name,
  labelPrefix = 'Source',
  className,
  ...props
}: SourceBadgeProps) {
  const sentence = describe({ kind, at, reference });

  return (
    <Tooltip content={sentence}>
      <Badge
        variant={kind === 'document' ? 'ai' : 'info'}
        role="img"
        tabIndex={0}
        aria-label={`${labelPrefix}: ${sentence}`}
        data-source={kind}
        className={cn(focusRing, className)}
        {...props}
      >
        <Icon icon={SOURCE_ICONS[kind]} />
        {name ?? SOURCE_NAMES[kind]}
      </Badge>
    </Tooltip>
  );
}
