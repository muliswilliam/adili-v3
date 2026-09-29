import { isRecord } from '../guards.js';
import type { SectionContents } from './sections.js';

/**
 * Attachment references inside a statement's items (spec 05): `declaration.v1`'s `Attachment`
 * (upload id, file name, SHA-256) in an item's `attachments`. The references are the service's:
 * written by link and unlink only, never taken from a section save. Pure; the contents are the
 * decrypted section.
 */

export interface AttachmentRef {
  uploadId: string;
  fileName: string;
  sha256: string;
}

/** The item lists of a statement. */
const ITEM_LISTS = ['income', 'assets', 'liabilities'] as const;

/** `declaration.v1` caps an attachment's file name. */
const FILE_NAME_MAX = 255;

/** A file name fit for the section: the uploader's, trimmed to the schema's cap, or a stand-in. */
export function attachmentFileName(fileName: string | null): string {
  const name = fileName?.trim() ?? '';
  return name === '' ? 'attachment' : name.slice(0, FILE_NAME_MAX);
}

/** Whether the statement has an item with this id. */
export function hasItem(contents: SectionContents, itemId: string): boolean {
  return ITEM_LISTS.some((list) => itemsOf(contents, list).some((item) => item.id === itemId));
}

/** The ids of the statement's items, every list. */
export function itemIds(contents: SectionContents): string[] {
  return ITEM_LISTS.flatMap((list) =>
    itemsOf(contents, list).flatMap((item) => (typeof item.id === 'string' ? [item.id] : [])),
  );
}

/** The contents with `ref` added to the item's attachments; null when there is no such item. */
export function withAttachment(
  contents: SectionContents,
  itemId: string,
  ref: AttachmentRef,
): SectionContents | null {
  if (!hasItem(contents, itemId)) return null;
  return mapItems(contents, (item) => {
    if (item.id !== itemId) return item;
    const kept = refsOf(item).filter((existing) => existing.uploadId !== ref.uploadId);
    return { ...item, attachments: [...kept, ref] };
  });
}

/** The contents with every reference to the upload removed. */
export function withoutAttachment(contents: SectionContents, uploadId: string): SectionContents {
  return mapItems(contents, (item) => {
    if (!Array.isArray(item.attachments)) return item;
    return { ...item, attachments: refsOf(item).filter((ref) => ref.uploadId !== uploadId) };
  });
}

/**
 * A statement body as saved, with each item's attachments as stored (by item id): the client
 * cannot add, change or drop a reference through a save. An item that had none keeps none; an
 * `attachments` list the client sent for it stays, emptied.
 */
export function keepAttachments(body: SectionContents, stored: SectionContents): SectionContents {
  const storedRefs = new Map<string, AttachmentRef[]>();
  for (const list of ITEM_LISTS) {
    for (const item of itemsOf(stored, list)) {
      if (typeof item.id === 'string' && refsOf(item).length > 0) {
        storedRefs.set(item.id, refsOf(item));
      }
    }
  }
  return mapItems(body, (item) => {
    const refs = typeof item.id === 'string' ? storedRefs.get(item.id) : undefined;
    if (refs) return { ...item, attachments: refs };
    if (!('attachments' in item)) return item;
    return { ...item, attachments: [] };
  });
}

type Item = Record<string, unknown>;

function itemsOf(contents: SectionContents, list: (typeof ITEM_LISTS)[number]): Item[] {
  const items = contents[list];
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

function refsOf(item: Item): AttachmentRef[] {
  return Array.isArray(item.attachments)
    ? item.attachments.filter(
        (ref): ref is AttachmentRef => isRecord(ref) && typeof ref.uploadId === 'string',
      )
    : [];
}

/** The contents with `map` applied to every item of every list; anything else as it was. */
function mapItems(contents: SectionContents, map: (item: Item) => Item): SectionContents {
  const copy: SectionContents = { ...contents };
  for (const list of ITEM_LISTS) {
    const items: unknown = contents[list];
    if (Array.isArray(items)) {
      copy[list] = items.map((item: unknown) => (isRecord(item) ? map(item) : item));
    }
  }
  return copy;
}
