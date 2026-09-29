import {
  File01Icon,
  LeftToRightListBulletIcon,
  PencilEdit02Icon,
  UserIcon,
} from '@hugeicons/core-free-icons';
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

/** What a ref opens: an item, a person's statement, a single field, or a whole section. */
export type SourceRefKind = 'item' | 'person' | 'field' | 'section';

/** The most specific part a ref names, or null when it names nothing. */
export function sourceRefKind({
  sectionKey,
  personKey,
  itemId,
  fieldPath,
}: SourceRef): SourceRefKind | null {
  if (itemId) return 'item';
  if (personKey) return 'person';
  if (fieldPath) return 'field';
  if (sectionKey) return 'section';
  return null;
}

// Query parameter per part, in the order they are written.
const PARAMS = [
  ['section', 'sectionKey'],
  ['person', 'personKey'],
  ['item', 'itemId'],
  ['field', 'fieldPath'],
] as const;

/**
 * A ref as query parameters, for a link that opens it: `section=assets&person=declarant&item=…`.
 * Parts that are null are left out; nothing set gives an empty string.
 */
export function sourceRefToSearch(ref: SourceRef): string {
  const search = new URLSearchParams();
  for (const [param, part] of PARAMS) {
    const value = ref[part];
    if (value) search.set(param, value);
  }
  return search.toString();
}

/** Reads a ref back from query parameters written by `sourceRefToSearch`, ignoring the rest. */
export function sourceRefFromSearch(search: string | URLSearchParams): SourceRef {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const ref: SourceRef = { sectionKey: null, personKey: null, itemId: null, fieldPath: null };
  for (const [param, part] of PARAMS) {
    // An empty parameter counts as absent, as `sourceRefToSearch` never writes one.
    const value = params.get(param);
    ref[part] = value === '' ? null : value;
  }
  return ref;
}

const KIND_ICONS: Record<SourceRefKind, IconProps['icon']> = {
  item: File01Icon,
  person: UserIcon,
  field: PencilEdit02Icon,
  section: LeftToRightListBulletIcon,
};

export interface SourceRefLinkMessages {
  /** Starts the accessible name: "Open in the declaration: {target}". */
  openPrefix: string;
}

const DEFAULT_MESSAGES: SourceRefLinkMessages = { openPrefix: 'Open in the declaration' };

const linkClassName = cn(
  focusRing,
  'inline-flex min-h-6 max-w-full cursor-pointer items-center gap-[5px] rounded-[7px] bg-muted py-0.5 pr-2 pl-1.5 text-left text-[12.5px] leading-[1.3] font-medium text-foreground hover:bg-border [&_svg]:size-[13px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
);

export interface SourceRefLinkProps extends Omit<ComponentProps<'button'>, 'children' | 'onClick'> {
  sourceRef: SourceRef;
  /** The chip's text, e.g. the item's description. Long text is cut with an ellipsis. */
  label: string;
  /**
   * The full target for the accessible name, e.g. "Assets, Building, 4-bedroom house on LR
   * 12715/482, Wanjiku Njeri Kamau". Defaults to `label`.
   */
  targetLabel?: string;
  /** Replaces the icon chosen by the ref's kind (an item's type icon, for instance). */
  icon?: IconProps['icon'];
  /**
   * Opens the target: in the console, the declaration pane scrolled to it and highlighted; on a
   * route, a navigation with `sourceRefToSearch`.
   */
  onOpen?: (ref: SourceRef) => void;
  messages?: Partial<SourceRefLinkMessages>;
}

/**
 * A chip that opens the part of the declaration an AI output drew on: an item, a person's
 * statement, a field or a section, with an icon for each. Screen readers hear where it goes:
 * "Open in the declaration: Assets, Building, 4-bedroom house on LR 12715/482". A ref that names
 * nothing is plain text.
 */
export function SourceRefLink({
  sourceRef,
  label,
  targetLabel,
  icon,
  onOpen,
  messages,
  className,
  ...props
}: SourceRefLinkProps) {
  const kind = sourceRefKind(sourceRef);
  const copy = { ...DEFAULT_MESSAGES, ...messages };

  if (!kind) {
    return <span className={cn('text-[12.5px] text-muted-foreground', className)}>{label}</span>;
  }

  return (
    <button
      type="button"
      {...props}
      aria-label={`${copy.openPrefix}: ${targetLabel ?? label}`}
      data-kind={kind}
      className={cn(linkClassName, className)}
      onClick={() => {
        onOpen?.(sourceRef);
      }}
    >
      <Icon icon={icon ?? KIND_ICONS[kind]} />
      <span className="truncate">{label}</span>
    </button>
  );
}
