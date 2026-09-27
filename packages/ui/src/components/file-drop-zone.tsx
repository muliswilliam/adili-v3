import { Upload04Icon } from '@hugeicons/core-free-icons';
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
import { describedBy, FieldError } from './form-field';
import { Icon } from './icon';

export type FileRejection = 'type' | 'size';

export type FileDropZoneProps = Omit<ComponentProps<'button'>, 'onSelect' | 'children'> & {
  /** Names the button, e.g. "Drop your roster file here or browse." */
  label: ReactNode;
  /** Shown in the zone under the label, e.g. accepted formats and the size limit. */
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
  const labelId = `${zoneId}-label`;
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
    <div className={cn('grid gap-2', className)}>
      <button
        type="button"
        id={zoneId}
        disabled={disabled}
        aria-labelledby={labelId}
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
        // Children ignore the pointer so moving over them does not fire dragleave on the zone.
        className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-input bg-card px-5 py-7 text-center transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:hover:border-foreground enabled:hover:bg-brand-faint disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-destructive/45 data-dragging:border-foreground data-dragging:bg-brand-faint [&>*]:pointer-events-none"
        {...props}
      >
        <span className="mb-0.5 flex size-11 items-center justify-center rounded-xl bg-muted text-secondary-foreground">
          <Icon icon={Upload04Icon} className="size-[18px]" />
        </span>
        <span id={labelId} className="text-[15px] font-semibold">
          {label}
        </span>
        {hint ? (
          <span id={hintId} className="text-[13.5px] text-muted-foreground">
            {hint}
          </span>
        ) : null}
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
      {shownError ? <FieldError id={errorId}>{shownError}</FieldError> : null}
    </div>
  );
}
