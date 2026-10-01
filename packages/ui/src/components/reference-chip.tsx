import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import { type ComponentProps, lazy, type ReactNode, Suspense, useState } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { CopyButton } from './copy-button';
import { Icon } from './icon';

/** What one hyphen-separated part of a reference number is. */
export interface ReferencePart {
  /** The part's role, e.g. "Type", "Issuer", "Year". */
  label: string;
  /** What this part says, from the numbering scheme registry, e.g. "Biennial declaration". */
  meaning: ReactNode;
}

export interface ReferenceChipMessages {
  copy: string;
  copied: string;
  explain: string;
  heading: string;
}

export const REFERENCE_CHIP_MESSAGES: ReferenceChipMessages = {
  copy: 'Copy reference number',
  copied: 'Reference number copied',
  explain: 'What does this reference mean?',
  heading: 'How to read this reference',
};

/** The names a declaration reference's breakdown needs from the registry and the directory. */
export interface DeclarationReferenceNames {
  /** The type code's name, e.g. "Biennial declaration" for DCB. */
  type: ReactNode;
  /** The issuer code's name, e.g. "Teachers Service Commission" for TSC. */
  issuer: ReactNode;
}

/** Labels and meanings of the parts a declaration reference's breakdown fills in itself. */
export interface DeclarationReferenceCopy {
  type: string;
  issuer: string;
  year: string;
  yearMeaning: ReactNode;
  sequence: string;
  sequenceMeaning: ReactNode;
  check: string;
  checkMeaning: ReactNode;
}

export const DECLARATION_REFERENCE_COPY: DeclarationReferenceCopy = {
  type: 'Type',
  issuer: 'Issuer',
  year: 'Year',
  yearMeaning: 'Year of the statement date',
  sequence: 'Sequence',
  sequenceMeaning: 'Number within that Commission and year',
  check: 'Check',
  checkMeaning: 'Catches typing mistakes',
};

/**
 * The five parts of a declaration reference (`DCB-TSC-2027-0012345-K`, ADR-011): type, issuer,
 * year, sequence and check. Pass the type and issuer names from the numbering scheme registry.
 */
export function declarationReferenceParts(
  names: DeclarationReferenceNames,
  copy: Partial<DeclarationReferenceCopy> = {},
): ReferencePart[] {
  const text = { ...DECLARATION_REFERENCE_COPY, ...copy };
  return [
    { label: text.type, meaning: names.type },
    { label: text.issuer, meaning: names.issuer },
    { label: text.year, meaning: text.yearMeaning },
    { label: text.sequence, meaning: text.sequenceMeaning },
    { label: text.check, meaning: text.checkMeaning },
  ];
}

export interface ReferenceChipProps {
  /** A reference number, e.g. `DCB-TSC-2027-0012345-K`. */
  reference: string;
  /**
   * One entry per hyphen-separated part, in order; the chip pairs each with its part of the
   * reference. With no parts, or a count that does not match, the chip offers no breakdown.
   */
  parts?: readonly ReferencePart[];
  /** Adds a button to copy the reference. Needs a ToastProvider. */
  copyable?: boolean;
  /** `lg` for the one reference a page is about, e.g. the submission success page. */
  size?: 'sm' | 'default' | 'lg';
  messages?: Partial<ReferenceChipMessages>;
  className?: string;
}

// The breakdown's popover (Radix, Floating UI) loads when someone first reaches for it, so pages
// that only show a reference, e.g. the verify app on a phone, do not download it up front.
const loadBreakdown = () => import('./reference-breakdown');
const ReferenceBreakdown = lazy(loadBreakdown);

/**
 * A reference number in mono, with a button to copy it and one that opens what each part
 * means (ADR-011 §6). The breakdown opens on click, tap, Enter or Space and closes with Esc
 * or a click outside; it is a non-modal popover so it also works on touch screens.
 */
export function ReferenceChip({
  reference,
  parts,
  copyable = true,
  size = 'default',
  messages,
  className,
}: ReferenceChipProps) {
  const [wanted, setWanted] = useState(false);
  const copy = { ...REFERENCE_CHIP_MESSAGES, ...messages };
  const segments = reference.split('-');
  const breakdown = parts?.length === segments.length ? parts : undefined;
  const small = size === 'sm';
  const large = size === 'lg';

  const chip = (explain: ReactNode) => (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 rounded-lg bg-card shadow-control',
        small ? 'py-0.5 pr-0.5 pl-2' : large ? 'py-1.5 pr-1.5 pl-3.5' : 'py-1 pr-1 pl-3',
        !copyable && !breakdown && (small ? 'pr-2' : large ? 'pr-3.5' : 'pr-3'),
        className,
      )}
    >
      <span
        className={cn(
          'min-w-0 truncate font-mono font-semibold tracking-[0.02em]',
          small ? 'text-[13px]' : large ? 'text-[17px]' : 'text-[15px]',
        )}
      >
        {reference}
      </span>
      {copyable ? (
        <CopyButton
          value={reference}
          label={copy.copy}
          copiedMessage={copy.copied}
          className={small ? 'size-7 [&_svg]:size-4' : undefined}
        />
      ) : null}
      {explain}
    </span>
  );
  if (!breakdown) return chip(null);

  const explainButton = (props: ComponentProps<typeof Button> = {}) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={small ? 'size-7 [&_svg]:size-4' : undefined}
      {...props}
    >
      <Icon icon={InformationCircleIcon} />
      <span className="sr-only">{copy.explain}</span>
    </Button>
  );
  // Until it is asked for, a plain button that fetches the breakdown on hover or focus and
  // opens it on press; the same button stands in while it loads.
  const placeholder = chip(
    explainButton({
      'aria-haspopup': 'dialog',
      'aria-expanded': false,
      onPointerEnter: () => void loadBreakdown(),
      onFocus: () => void loadBreakdown(),
      onClick: () => {
        setWanted(true);
      },
    }),
  );
  if (!wanted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <ReferenceBreakdown
        chip={chip}
        trigger={explainButton()}
        segments={segments}
        parts={breakdown}
        heading={copy.heading}
      />
    </Suspense>
  );
}
