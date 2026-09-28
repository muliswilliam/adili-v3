import type { ItemSourceDetails } from '@adili/ui';

import { ITEM_SOURCE_KINDS, type ItemSourceKind } from './contents';
import type { Item } from './statement';
import { fieldText, identifierPath, readPath } from './suggestions';

/**
 * What a SourceBadge needs for an item that came from a registry or a document, or null for an
 * item entered by hand. `ItemSource` carries no identifier, so it comes from the item's own
 * fields: the field that identifies an item of its type (registration, parcel or plot number,
 * company), the same one suggestions are matched on. For a document it is the file name when
 * the item has only one; with several, `ItemSource` does not say which was read (no page or
 * file reference: contract gap), so the badge falls back to the item's identifier.
 */
export function sourceDetails(item: Item): ItemSourceDetails | null {
  const source = item.source;
  if (!source?.at || !isSourceKind(source.kind)) return null;
  return { kind: source.kind, at: source.at, reference: sourceReference(item, source.kind) };
}

function sourceReference(item: Item, kind: ItemSourceKind): string | undefined {
  if (kind === 'document') {
    const files = item.attachments ?? [];
    const only = files.length === 1 ? files[0]?.fileName?.trim() : undefined;
    if (only) return only;
  }
  const path = identifierPath(item.type ?? '');
  return (path ? fieldText(readPath(item, path)) : '') || undefined;
}

function isSourceKind(kind: unknown): kind is ItemSourceKind {
  return (ITEM_SOURCE_KINDS as readonly unknown[]).includes(kind);
}
