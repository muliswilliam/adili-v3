import {
  AlertCircleIcon,
  Attachment01Icon,
  Cancel01Icon,
  File01Icon,
  Upload04Icon,
} from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { type FileRejection, matchesAccept } from './file-drop-zone';
import { FieldHint } from './form-field';
import { Icon } from './icon';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';

export type AttachmentStatus =
  'uploading' | 'scanning' | 'linked' | 'infected' | 'rejected-type' | 'rejected-size' | 'failed';

export interface AttachmentListItem {
  id: string;
  /** The file name. */
  name: string;
  status: AttachmentStatus;
  /** Size in bytes, shown once linked. */
  size?: number;
  /** Upload progress 0-100 while uploading. */
  progress?: number;
  /** Replaces the status line, e.g. "Read into the form". */
  detail?: ReactNode;
}

export interface AttachmentMessages {
  uploading: string;
  scanning: string;
  linked: string;
  infected: string;
  'rejected-type': string;
  'rejected-size': string;
  failed: string;
  /** Title of the confirmation before a linked file is removed. */
  removeTitle: (name: string) => string;
  removeBody: string;
  removeConfirm: string;
  cancel: string;
  retry: string;
}

const DEFAULT_MESSAGES: AttachmentMessages = {
  uploading: 'Uploading…',
  scanning: 'Checking the file for viruses…',
  linked: 'Attached',
  infected: 'This file failed the security scan and was not attached.',
  'rejected-type': 'This file type cannot be attached. Use a PDF, JPEG, PNG or HEIC file.',
  'rejected-size':
    'This file is larger than 20 MB. Use a smaller file or a lower-resolution photo.',
  failed: 'The upload did not finish. Check your connection and try again.',
  removeTitle: (name) => `Remove ${name}?`,
  removeBody: 'The document will no longer be attached to this item. You can add it again later.',
  removeConfirm: 'Remove document',
  cancel: 'Cancel',
  retry: 'Try again',
};

const PROBLEMS: AttachmentStatus[] = ['infected', 'rejected-type', 'rejected-size', 'failed'];

/** Bytes → "1.8 MB" or "240 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export type AttachmentListProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** Names the list, e.g. "Documents for this asset". */
  label: string;
  attachments: AttachmentListItem[];
  /** Called with a file the user picked, and why it was rejected in the browser, if it was. */
  onAdd?: (file: File, rejection: FileRejection | null) => void;
  /** File extensions or MIME types the add button accepts. Any file when empty. */
  accept?: string[];
  /** Largest file in bytes the add button accepts. */
  maxSize?: number;
  /** Names the add button. Defaults to "Add document". */
  addLabel?: string;
  /** Shown next to the add button, e.g. "PDF, JPEG, PNG or HEIC, up to 20 MB." */
  addHint?: ReactNode;
  /** Removes a linked file, after the user confirms. */
  onRemove?: (attachment: AttachmentListItem) => void;
  /** Clears a file that did not attach (infected, rejected or failed). */
  onDismiss?: (attachment: AttachmentListItem) => void;
  /** Uploads a failed file again. */
  onRetry?: (attachment: AttachmentListItem) => void;
  /** Replaces any of the default copy. */
  messages?: Partial<AttachmentMessages>;
  disabled?: boolean;
};

function statusSnapshot(attachments: AttachmentListItem[]) {
  return attachments.map((attachment) => `${attachment.id}:${attachment.status}`).join('|');
}

/**
 * The files attached to a form item, one row per file in every upload state: uploading with
 * progress, scanning, linked, infected, rejected and failed. Problems are shown in text with an
 * icon, never colour alone, and a file finishing (attached or not) is announced politely.
 * Removing a linked file asks for confirmation first.
 */
export function AttachmentList({
  label,
  attachments,
  onAdd,
  accept = [],
  maxSize,
  addLabel = 'Add document',
  addHint,
  onRemove,
  onDismiss,
  onRetry,
  messages: messageOverrides,
  disabled = false,
  className,
  ...props
}: AttachmentListProps) {
  const messages = { ...DEFAULT_MESSAGES, ...messageOverrides };
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<AttachmentListItem | null>(null);

  // Announce a file reaching a final state, but not the files already there on first render.
  const snapshot = statusSnapshot(attachments);
  const [seen, setSeen] = useState(() => ({
    snapshot,
    statuses: new Map(attachments.map((attachment) => [attachment.id, attachment.status])),
  }));
  const [announcement, setAnnouncement] = useState('');
  if (seen.snapshot !== snapshot) {
    const finished = attachments.filter(
      (attachment) =>
        seen.statuses.get(attachment.id) !== attachment.status &&
        (attachment.status === 'linked' || PROBLEMS.includes(attachment.status)),
    );
    setSeen({
      snapshot,
      statuses: new Map(attachments.map((attachment) => [attachment.id, attachment.status])),
    });
    if (finished.length > 0) {
      setAnnouncement(
        finished
          .map((attachment) =>
            attachment.status === 'linked'
              ? `${attachment.name} attached.`
              : `${attachment.name}: ${messages[attachment.status]}`,
          )
          .join(' '),
      );
    }
  }

  function statusLine(attachment: AttachmentListItem): ReactNode {
    if (attachment.detail !== undefined) return attachment.detail;
    if (attachment.status === 'linked') {
      return attachment.size === undefined
        ? messages.linked
        : `${formatFileSize(attachment.size)} · ${messages.linked}`;
    }
    return messages[attachment.status];
  }

  return (
    <div className={cn('grid gap-2.5', className)} {...props}>
      {attachments.length > 0 ? (
        <ul aria-label={label} className="grid gap-2">
          {attachments.map((attachment) => {
            const problem = PROBLEMS.includes(attachment.status);
            return (
              <li
                key={attachment.id}
                data-status={attachment.status}
                className={cn(
                  'flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 shadow-card',
                  problem && 'inset-ring inset-ring-destructive/30',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-secondary-foreground',
                    problem && 'bg-destructive-subtle text-destructive-subtle-foreground',
                  )}
                >
                  {attachment.status === 'uploading' ? (
                    <Icon icon={Upload04Icon} />
                  ) : attachment.status === 'scanning' ? (
                    <Spinner className="size-4" />
                  ) : problem ? (
                    <Icon icon={AlertCircleIcon} />
                  ) : (
                    <Icon icon={File01Icon} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{attachment.name}</div>
                  {attachment.status === 'uploading' ? (
                    <ProgressBar
                      label={`Uploading ${attachment.name}`}
                      value={attachment.progress ?? 0}
                      size="sm"
                      status={messages.uploading}
                      announceEvery={50}
                      className="mt-1.5 gap-1"
                    />
                  ) : (
                    <div
                      className={cn(
                        'text-[12.5px] text-muted-foreground',
                        problem && 'text-destructive',
                      )}
                    >
                      {statusLine(attachment)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {attachment.status === 'failed' && onRetry ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={disabled}
                      aria-label={`${messages.retry}: ${attachment.name}`}
                      onClick={() => {
                        onRetry(attachment);
                      }}
                    >
                      {messages.retry}
                    </Button>
                  ) : null}
                  {problem && onDismiss ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={`Dismiss ${attachment.name}`}
                      onClick={() => {
                        onDismiss(attachment);
                      }}
                    >
                      <Icon icon={Cancel01Icon} />
                    </Button>
                  ) : null}
                  {attachment.status === 'linked' && onRemove ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => {
                        setConfirming(attachment);
                      }}
                    >
                      <Icon icon={Cancel01Icon} />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {onAdd ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            aria-describedby={addHint ? hintId : undefined}
            onClick={() => inputRef.current?.click()}
          >
            <Icon icon={Attachment01Icon} />
            {addLabel}
          </Button>
          {addHint ? <FieldHint id={hintId}>{addHint}</FieldHint> : null}
          <input
            ref={inputRef}
            type="file"
            hidden
            tabIndex={-1}
            accept={accept.length > 0 ? accept.join(',') : undefined}
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clear it so picking the same file again still fires change.
              event.target.value = '';
              if (!file) return;
              const rejection: FileRejection | null = !matchesAccept(file, accept)
                ? 'type'
                : maxSize !== undefined && file.size > maxSize
                  ? 'size'
                  : null;
              onAdd(file, rejection);
            }}
          />
        </div>
      ) : null}
      <div role="status" className="sr-only">
        {announcement}
      </div>
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{messages.removeTitle(confirming?.name ?? '')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>{messages.removeBody}</DialogDescription>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {messages.cancel}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (confirming) onRemove?.(confirming);
                setConfirming(null);
              }}
            >
              {messages.removeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
