import { File01Icon, LeftToRightListBulletIcon, UserIcon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon, type IconProps } from './icon';

/**
 * A pointer into a `declaration.v1` document, as ai-gateway outputs carry it. Each part is null
 * when the ref does not name it; `fieldPath` is a JSON pointer.
 */
export interface SourceRef {
  sectionKey: string | null;
  personKey: string | null;
  itemId: string | null;
  fieldPath: string | null;
}

/** What a ref opens: an item, a person's financial statement, a single field, or a whole section. */
export type SourceRefTarget = 'item' | 'person' | 'field' | 'section';

/**
 * The most specific part a ref names, or null when it names nothing. A field path is more specific
 * than the person or section it sits in, so it wins over both.
 */
export function sourceRefTarget({
  sectionKey,
  personKey,
  itemId,
  fieldPath,
}: SourceRef): SourceRefTarget | null {
  if (itemId) return 'item';
  if (fieldPath) return 'field';
  if (personKey) return 'person';
  if (sectionKey) return 'section';
  return null;
}

const TARGET_ICONS: Record<SourceRefTarget, IconProps['icon']> = {
  item: File01Icon,
  person: UserIcon,
  field: LeftToRightListBulletIcon,
  section: LeftToRightListBulletIcon,
};

export interface SourceRefLinkMessages {
  /** Starts the accessible name: "Open in the declaration: {target}". */
  openPrefix: string;
}

const DEFAULT_MESSAGES: SourceRefLinkMessages = { openPrefix: 'Open in the declaration' };

const linkClassName = cn(
  focusRing,
  'inline-flex min-h-6 max-w-full cursor-pointer items-center gap-[5px] overflow-hidden rounded-chip bg-muted py-0.5 pr-2 pl-1.5 text-left text-[12.5px] leading-[1.3] font-medium text-foreground hover:bg-input [&_svg]:size-[13px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
);

export interface SourceRefLinkProps extends Omit<ComponentProps<'button'>, 'children' | 'onClick'> {
  sourceRef: SourceRef;
  /** The chip's text, e.g. the item's description. Long text is cut with an ellipsis. */
  label: string;
  /**
   * Muted text after the label that is never cut, for what tells two chips of the same label
   * apart, e.g. whose statement a jointly held item is in.
   */
  detail?: string | null;
  /**
   * The full target for the accessible name, e.g. "Assets, Building, 4-bedroom house on LR
   * 12715/482, Wanjiku Njeri Kamau". Defaults to `label`.
   */
  targetLabel?: string;
  /** Replaces the icon chosen by what the ref opens (an item's type icon, for instance). */
  icon?: IconProps['icon'];
  /**
   * Opens the target: in the console, the declaration pane scrolled to it and highlighted; in the
   * portal, the field focused.
   */
  onOpen: (ref: SourceRef) => void;
  messages?: Partial<SourceRefLinkMessages>;
}

/**
 * A chip that opens the part of the declaration an AI output drew on: an item, a person's
 * financial statement, a field or a section, with an icon for each. Screen readers hear where it goes:
 * "Open in the declaration: Assets, Building, 4-bedroom house on LR 12715/482". A ref that names
 * nothing is plain text.
 */
export function SourceRefLink({
  sourceRef,
  label,
  detail,
  targetLabel,
  icon,
  onOpen,
  messages,
  className,
  ...props
}: SourceRefLinkProps) {
  const target = sourceRefTarget(sourceRef);
  const copy = { ...DEFAULT_MESSAGES, ...messages };

  if (!target) {
    const { id, title, ...rest } = props;
    const spanProps = Object.fromEntries(
      // A plain span can't be named, so a caller's aria-label or aria-labelledby is left off.
      Object.entries(rest).filter(
        ([key]) =>
          key.startsWith('data-') ||
          (key.startsWith('aria-') && key !== 'aria-label' && key !== 'aria-labelledby'),
      ),
    );
    return (
      <span
        id={id}
        title={title}
        {...spanProps}
        className={cn('text-[12.5px] text-muted-foreground', className)}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={`${copy.openPrefix}: ${targetLabel ?? label}`}
      data-target={target}
      {...props}
      className={cn(linkClassName, className)}
      onClick={() => {
        onOpen(sourceRef);
      }}
    >
      <Icon icon={icon ?? TARGET_ICONS[target]} />
      {/* min-w-0: the label gives way first, so a chip never widens what holds it; a long
          detail (a person's full name) is cut too, past the chip's last 45%. */}
      <span className="min-w-0 truncate">{label}</span>
      {detail ? (
        <span className="max-w-[45%] shrink-0 truncate font-normal text-muted-foreground">
          · {detail}
        </span>
      ) : null}
    </button>
  );
}
