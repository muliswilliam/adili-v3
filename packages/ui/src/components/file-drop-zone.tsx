import { CloudUploadIcon } from '@hugeicons/core-free-icons';
import {
  type ChangeEvent,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../lib/cn';
import { describedBy, FieldError, FieldHint } from './form-field';
import { Icon } from './icon';

export type FileRejection = 'type' | 'size';

export type FileDropZoneProps = Omit<ComponentProps<'button'>, 'onSelect' | 'children'> & {
  /** Names the button, e.g. "Drop your roster file here or browse." */
  label: ReactNode;
  /** Shown under the zone, e.g. accepted formats and the size limit. */
  hint?: ReactNode;
  /** File extensions (".csv") or MIME types ("text/csv", "image/*"). Any file when empty. */
  accept?: string[];
  /** Largest accepted file in bytes. */
  maxSize?: number;
  /** Messages for files rejected in the browser. */
  messages: {
    type: (file: File) => ReactNode;
    size: (file: File) => ReactNode;
  };
  /** Called with a file that passed the type and size checks. */
  onFileAccepted: (file: File) => void;
  /** Called when a file is rejected, after its message is shown. */
  onFileRejected?: (file: File, reason: FileRejection) => void;
  /** An error from outside, e.g. the server rejected the upload. Replaces the client message. */
  error?: ReactNode;
};

/** Whether the file matches one of the extensions or MIME types in `accept`. */
export function matchesAccept(file: File, accept: string[]): boolean {
  if (accept.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * A single-file picker. The zone is one labelled button, so keyboard users open the file
 * picker with Enter or Space; mouse users can also drop a file on it. Files of the wrong type
 * or size are rejected before upload with the messages passed in.
 */
export function FileDropZone({
  label,
  hint,
  accept = [],
  maxSize,
  messages,
  onFileAccepted,
  onFileRejected,
  error,
  id,
  disabled,
  className,
  onClick,
  ...props
}: FileDropZoneProps) {
  const generatedId = useId();
  const zoneId = id ?? generatedId;
  const hintId = hint ? `${zoneId}-hint` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<ReactNode>(null);
  const shownError = error ?? rejection;
  const errorId = shownError ? `${zoneId}-error` : undefined;

  function take(file: File | undefined) {
    if (!file) return;
    if (!matchesAccept(file, accept)) {
      setRejection(messages.type(file));
      onFileRejected?.(file, 'type');
      return;
    }
    if (maxSize !== undefined && file.size > maxSize) {
      setRejection(messages.size(file));
      onFileRejected?.(file, 'size');
      return;
    }
    setRejection(null);
    onFileAccepted(file);
  }

  function handleDrag(event: DragEvent<HTMLButtonElement>, over: boolean) {
    event.preventDefault();
    if (disabled) return;
    setDragging(over);
  }

  return (
    <div className={cn('grid gap-1.5', className)}>
      <button
        type="button"
        id={zoneId}
        disabled={disabled}
        aria-describedby={describedBy(hintId, errorId)}
        aria-invalid={shownError ? true : undefined}
        data-dragging={dragging || undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) inputRef.current?.click();
        }}
        onDragEnter={(event) => {
          handleDrag(event, true);
        }}
        onDragOver={(event) => {
          handleDrag(event, true);
        }}
        onDragLeave={(event) => {
          handleDrag(event, false);
        }}
        onDrop={(event) => {
          handleDrag(event, false);
          if (!disabled) take(event.dataTransfer.files[0]);
        }}
        className="flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-control px-6 py-8 text-center text-sm transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive data-dragging:border-primary data-dragging:bg-muted"
        {...props}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon icon={CloudUploadIcon} className="size-5" />
        </span>
        <span className="font-medium">{label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        accept={accept.length > 0 ? accept.join(',') : undefined}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          take(event.target.files?.[0]);
          // Clear it so picking the same file again after a fix still fires change.
          event.target.value = '';
        }}
      />
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      {shownError ? <FieldError id={errorId}>{shownError}</FieldError> : null}
    </div>
  );
}
