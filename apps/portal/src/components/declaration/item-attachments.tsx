import {
  AttachmentList,
  type AttachmentListItem,
  FieldHint,
  formatFileSize,
  MenuItem,
  MenuNote,
  useToast,
} from '@adili/ui';
import { SparklesIcon } from '@hugeicons/core-free-icons';
import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useId,
  useReducer,
  useState,
} from 'react';

import {
  getDeclarationSection,
  linkDeclarationAttachment,
  unlinkDeclarationAttachment,
} from '../../server/declarations';
import {
  completeAttachmentUpload,
  createAttachmentUpload,
  getAttachmentUpload,
} from '../../server/documents/uploads';
import {
  type LinkOutcome,
  putToPresignedUrl,
  uploadAttachment,
  type UploadSteps,
} from './attachment-upload';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_COPY,
  ATTACHMENT_MAX_BYTES,
  attachmentRows,
  initialUploads,
  type UploadsEvent,
  type UploadsState,
  uploadsReducer,
} from './attachments';
import type { Attachment, Draft } from '../../declaration/contents';
import { EXTRACTION_COPY } from '../../declaration/copy';
import { useExtractionEnabled } from './extraction-availability';
import { ReadIntoForm, type ReadTarget } from './read-into-form';
import type { ItemAttachmentSlot, RenderAttachments } from './statement-item-editor';
import { useWorkspace } from './workspace';

/**
 * The documents under an income, asset or liability item (#125; a payslip under a salary, #681). The provider keeps the files on their way
 * for the whole statement screen, so an upload carries on when its item's editor closes; each
 * editor renders `ItemAttachments` in the slot the statement section leaves for it.
 *
 * Linking and unlinking change the draft on the service and bump its version, so they run under
 * the workspace's `whileHeld`: waiting edits go first (a new item must exist before a document
 * is linked to it), autosave waits, and the section is read back for the new ETag and the
 * item's attachments together.
 *
 * A linked file's menu offers "Read into the form" (#316), by the attachment id the item's
 * reference carries, however long ago it was linked; once the Commission is known not to read
 * documents, the menu says so instead.
 */

interface Uploads {
  state: UploadsState;
  dispatch: Dispatch<UploadsEvent>;
  /** The picked files by row id, to upload a failed one again. */
  files: Map<string, File>;
  /** Upload ids of documents read into the form in this visit. */
  read: ReadonlySet<string>;
  markRead: (uploadId: string) => void;
}

const UploadsContext = createContext<Uploads | null>(null);

export function AttachmentUploadsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uploadsReducer, initialUploads);
  const [files] = useState(() => new Map<string, File>());
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const markRead = (uploadId: string) => {
    setRead((current) => new Set([...current, uploadId]));
  };
  return (
    <UploadsContext value={{ state, dispatch, files, read, markRead }}>{children}</UploadsContext>
  );
}

function useUploads(): Uploads {
  const value = useContext(UploadsContext);
  if (!value) throw new Error('ItemAttachments must be inside an AttachmentUploadsProvider');
  return value;
}

/** Renders `ItemAttachments` in the statement section's slot. */
export const renderItemAttachments: RenderAttachments = (slot) => <ItemAttachments slot={slot} />;

function complete(attachments: Draft<Attachment>[]): Attachment[] {
  return attachments.filter(
    (attachment): attachment is Attachment =>
      typeof attachment.attachmentId === 'string' &&
      typeof attachment.uploadId === 'string' &&
      typeof attachment.fileName === 'string' &&
      typeof attachment.sha256 === 'string',
  );
}

/** The item's attachments as the service holds them, from a fresh read of the section. */
function attachmentsIn(
  contents: Record<string, unknown>,
  category: ItemAttachmentSlot['category'],
  itemId: string,
): Attachment[] | null {
  const items = contents[category];
  if (!Array.isArray(items)) return null;
  const item = (items as { id?: string; attachments?: Draft<Attachment>[] }[]).find(
    (candidate) => candidate.id === itemId,
  );
  return item ? complete(item.attachments ?? []) : null;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function ItemAttachments({ slot }: { slot: ItemAttachmentSlot }) {
  const { declaration, whileHeld } = useWorkspace();
  const { state, dispatch, files, read, markRead } = useUploads();
  const { toast } = useToast();
  const headingId = useId();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [reading, setReading] = useState<(ReadTarget & { uploadId: string }) | null>(null);
  const declarationId = declaration.id;
  const canRead = useExtractionEnabled(declarationId);
  const { sectionKey } = slot;
  const { itemId, category } = slot;

  /** Runs a link or unlink with autosave held, then takes the item's attachments read back. */
  async function writeHeld<T>(
    write: () => Promise<{ ok: false } | { ok: true; value: T; fallback: Attachment[] }>,
  ): Promise<T | null> {
    try {
      const held = await whileHeld(async () => {
        const written = await write();
        if (!written.ok) return { value: null, etag: null, version: 0 };
        const fresh = await getDeclarationSection({ data: { declarationId, sectionKey } });
        if (fresh.status !== 'ok') {
          slot.setAttachments(written.fallback);
          return { value: written.value, etag: null, version: 0 };
        }
        slot.setAttachments(
          attachmentsIn(fresh.section.contents, category, itemId) ?? written.fallback,
        );
        return { value: written.value, etag: fresh.etag, version: fresh.section.draftVersion };
      });
      return held.status === 'done' ? held.value : null;
    } catch {
      return null;
    }
  }

  async function link(uploadId: string): Promise<LinkOutcome> {
    const linked = await writeHeld(async () => {
      const result = await linkDeclarationAttachment({
        data: { declarationId, sectionKey, itemId, uploadId },
      });
      if (result.status !== 'linked') return { ok: false };
      const { attachment } = result;
      return {
        ok: true,
        value: attachment,
        fallback: [
          ...complete(slot.attachments).filter((each) => each.uploadId !== uploadId),
          {
            attachmentId: attachment.id,
            uploadId,
            fileName: attachment.fileName,
            sha256: attachment.sha256,
          },
        ],
      };
    });
    return linked ? { status: 'linked', size: linked.size } : { status: 'failed' };
  }

  const steps: UploadSteps = {
    reserve: (file) => createAttachmentUpload({ data: file }),
    put: putToPresignedUrl,
    complete: (uploadId) => completeAttachmentUpload({ data: { uploadId } }),
    check: (uploadId) => getAttachmentUpload({ data: { uploadId } }),
    link,
    wait,
  };

  function start(rowId: string, file: File) {
    void uploadAttachment(rowId, file, steps, (event) => {
      // Keep the file until it is linked, so a failed upload can be tried again.
      if (event.type === 'linked') files.delete(rowId);
      dispatch(event);
    });
  }

  /**
   * Unlinks a document however long ago it was linked: the service drops the link and the
   * item's reference together and records the unlink, then the section is read back.
   */
  async function remove(row: AttachmentListItem) {
    const uploadId = row.id;
    const all = complete(slot.attachments);
    const attachment = all.find((each) => each.uploadId === uploadId);
    if (!attachment) {
      toast({ title: ATTACHMENT_COPY.removeFailed });
      return;
    }
    const rest = all.filter((each) => each.uploadId !== uploadId);
    setRemoving((current) => new Set([...current, uploadId]));
    const removed = await writeHeld(async () => {
      const result = await unlinkDeclarationAttachment({
        data: { declarationId, attachmentId: attachment.attachmentId },
      });
      // Gone already is as good as removed.
      if (result.status !== 'unlinked' && result.status !== 'not-found') return { ok: false };
      return { ok: true, value: true, fallback: rest };
    });
    setRemoving((current) => new Set([...current].filter((each) => each !== uploadId)));
    if (removed) {
      dispatch({ type: 'unlinked', uploadId });
      toast({ title: ATTACHMENT_COPY.removed });
    } else {
      toast({ title: ATTACHMENT_COPY.removeFailed });
    }
  }

  const rows = attachmentRows(itemId, slot.attachments, state)
    .filter((row) => !removing.has(row.id))
    .map((row): AttachmentListItem => {
      if (!read.has(row.id)) return row;
      const detail = EXTRACTION_COPY.rowDetail;
      return {
        ...row,
        detail: row.size === undefined ? detail : `${formatFileSize(row.size)} · ${detail}`,
      };
    });

  function readMenu(row: AttachmentListItem) {
    if (!canRead) return <MenuNote icon={SparklesIcon}>{EXTRACTION_COPY.notEnabled}</MenuNote>;
    const known = complete(slot.attachments).find((each) => each.uploadId === row.id);
    if (!known) return null;
    return (
      <MenuItem
        icon={SparklesIcon}
        tone="ai"
        onSelect={() => {
          setReading({ attachmentId: known.attachmentId, fileName: row.name, uploadId: row.id });
        }}
      >
        {EXTRACTION_COPY.menu}
      </MenuItem>
    );
  }

  return (
    <div role="group" aria-labelledby={headingId} className="grid gap-2">
      <div className="grid gap-0.5">
        <span id={headingId} className="text-sm font-medium">
          {ATTACHMENT_COPY.heading}
        </span>
        <FieldHint>{ATTACHMENT_COPY.hint}</FieldHint>
      </div>
      <AttachmentList
        label={`Documents for this ${slot.itemNoun}`}
        attachments={rows}
        accept={ATTACHMENT_ACCEPT}
        maxSize={ATTACHMENT_MAX_BYTES}
        addHint={ATTACHMENT_COPY.addHint}
        disabled={slot.disabled}
        onAdd={(file, rejection) => {
          const rowId = crypto.randomUUID();
          dispatch({
            type: 'picked',
            id: rowId,
            itemId,
            name: file.name,
            size: file.size,
            rejection,
          });
          if (rejection) return;
          files.set(rowId, file);
          start(rowId, file);
        }}
        onRetry={(row) => {
          const file = files.get(row.id);
          if (!file) return;
          dispatch({ type: 'retry', id: row.id });
          start(row.id, file);
        }}
        onDismiss={(row) => {
          files.delete(row.id);
          dispatch({ type: 'dismissed', id: row.id });
        }}
        onRemove={(row) => {
          void remove(row);
        }}
        menuItems={readMenu}
      />
      <ReadIntoForm
        target={reading}
        sectionKey={sectionKey}
        itemId={itemId}
        itemType={slot.itemType}
        item={slot.item}
        onClose={() => {
          setReading(null);
        }}
        onApplied={({ itemId: acceptedId, contents, mode }) => {
          if (contents) slot.onAccepted?.(acceptedId, contents);
          if (reading) markRead(reading.uploadId);
          toast({ title: mode === 'apply' ? EXTRACTION_COPY.applied : EXTRACTION_COPY.added });
        }}
      />
    </div>
  );
}
