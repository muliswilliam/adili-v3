import type { ItemSourceDetails } from '@adili/ui';

import { ITEM_SOURCE_KINDS, type ItemSourceKind } from '../../declaration/contents';
import type { Item } from '../../declaration/statement';

/** A statement item's fields the source identifier can come from, most specific first. */
const REFERENCE_FIELDS = ['registration', 'parcelNumber', 'issuer'] as const;

/**
 * What a SourceBadge needs for an item that came from a registry or a document, or null for an
 * item entered by hand. `ItemSource` carries no identifier, so it comes from the item's own
 * fields: the registration, parcel or plot number or company (registries), or the file name
 * of the item's first document (documents).
 */
export function sourceDetails(item: Item): ItemSourceDetails | null {
  const source = item.source;
  if (!source?.at || !isSourceKind(source.kind)) return null;
  return { kind: source.kind, at: source.at, reference: sourceReference(item, source.kind) };
}

function sourceReference(item: Item, kind: ItemSourceKind): string | undefined {
  if (kind === 'document') {
    return item.attachments?.map((attachment) => attachment.fileName?.trim()).find(Boolean);
  }
  const details = 'details' in item ? item.details : undefined;
  return REFERENCE_FIELDS.map((field) => details?.[field]?.trim()).find(Boolean);
}

function isSourceKind(kind: unknown): kind is ItemSourceKind {
  return (ITEM_SOURCE_KINDS as readonly unknown[]).includes(kind);
}
