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
import { focusRing } from '../lib/focus';
import { joinIds } from '../lib/use-field-ids';
import { FieldError } from './form-field';
import { Icon } from './icon';

export type FileRejection = 'type' | 'size';

/**
 * `className` styles the wrapper around the zone and its error message; every other prop,
 * including `id` and `aria-*`, goes to the zone's button. The caller's `aria-describedby` and
 * `aria-labelledby` are joined with the zone's own ids, and the caller's click and drag
 * handlers run before the zone's, which still validates every dropped file.
 */
export type FileDropZoneProps = Omit<ComponentProps<'button'>, 'onSelect' | 'children'> & {
  /** Names the button, e.g. "Drop your roster file here or browse." */
  label: ReactNode;
  /** Shown in the zone under the label, e.g. accepted formats and the size limit. */
  hint?: ReactNode;
  /**
   * File extensions (".csv") or MIME types ("text/csv", "image/*"). Any file when empty.
   * Include extensions: Windows reports some CSVs as `application/vnd.ms-excel` or with no type.
   */
  accept?: string[];
  /** Largest accepted file in bytes. */
  maxSize?: number;
  /** Messages for files rejected in the browser. */
  messages: Record<FileRejection, (file: File) => ReactNode>;
  /** Called with a file that passed the type and size checks. */
  onFileAccepted: (file: File) => void;
  /** Called when a file is rejected, after its message is shown. */
  onFileRejected?: (file: File, reason: FileRejection) => void;
  /**
   * An error from outside, e.g. the server rejected the upload. A client message (a file rejected
   * in the browser) is shown in place of this until either the next file is accepted or this
   * changes to a new error. Clearing this never hides a client message, so a parent may reset
   * it in `onFileRejected` or `onFileAccepted`; setting the same message again after clearing
   * it shows it again.
   */
  error?: string | undefined;
};

/**
 * Whether the file matches one of the extensions or MIME types in `accept`. Extensions match
 * the file name in any case, a bare `*` or the any-type wildcard matches every file, and blank
 * entries are ignored.
 *
 * MIME rules rely on the type the browser reports, which is often missing or wrong: Windows
 * reports CSVs as `application/vnd.ms-excel` or `""`, so `text/csv` alone misses them. Pass
 * the extension (".csv") as well.
 */
export function matchesAccept(file: File, accept: string[]): boolean {
  const rules = acceptRules(accept);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((entry) => {
    const rule = entry.toLowerCase();
    if (rule === '*' || rule === '*/*') return true;
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function acceptRules(accept: string[]) {
  return accept.map((entry) => entry.trim()).filter((rule) => rule !== '');
}

function rejectionFor(file: File, accept: string[], maxSize?: number): FileRejection | null {
  if (!matchesAccept(file, accept)) return 'type';
  if (maxSize !== undefined && file.size > maxSize) return 'size';
  return null;
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
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  'aria-describedby': ariaDescribedBy,
  'aria-labelledby': ariaLabelledBy,
  'aria-invalid': ariaInvalid,
  ...props
}: FileDropZoneProps) {
  // Own ids come from useId, not `id`, so they cannot clash with a FormField's hint and error.
  const partId = useId();
  const labelId = `${partId}-label`;
  const hintId = hint ? `${partId}-hint` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<ReactNode>(null);
  // A new outside error replaces the client message, so the latest of the two is shown.
  const [previousError, setPreviousError] = useState(error);
  if (error !== previousError) {
    setPreviousError(error);
    if (error) setRejection(null);
  }
  const shownError = rejection ?? error;
  const errorId = shownError ? `${partId}-error` : undefined;
  const invalid =
    Boolean(shownError) ||
    (ariaInvalid !== undefined && ariaInvalid !== false && ariaInvalid !== 'false');
  const rules = acceptRules(accept);

  function take(file: File | undefined) {
    if (!file) return;
    const reason = rejectionFor(file, accept, maxSize);
    if (reason) {
      setRejection(messages[reason](file));
      onFileRejected?.(file, reason);
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

  // A disabled button ignores the pointer, so drag events reach the wrapper instead; without
  // this a file dropped on a disabled zone would open in the tab. An enabled zone leaves drops
  // elsewhere in the wrapper, such as on its error, to the page.
  function blockDrop(event: DragEvent<HTMLDivElement>) {
    if (!disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  }

  return (
    <div
      className={cn('grid gap-2', disabled && 'cursor-not-allowed', className)}
      onDragOver={blockDrop}
      onDrop={blockDrop}
    >
      <button
        type="button"
        {...props}
        id={id}
        disabled={disabled}
        aria-labelledby={joinIds(labelId, ariaLabelledBy)}
        aria-describedby={joinIds(ariaDescribedBy, hintId, errorId)}
        aria-invalid={invalid || undefined}
        data-dragging={dragging || undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) inputRef.current?.click();
        }}
        onDragEnter={(event) => {
          onDragEnter?.(event);
          handleDrag(event, true);
        }}
        onDragOver={(event) => {
          onDragOver?.(event);
          handleDrag(event, true);
        }}
        onDragLeave={(event) => {
          onDragLeave?.(event);
          handleDrag(event, false);
        }}
        onDrop={(event) => {
          onDrop?.(event);
          handleDrag(event, false);
          // Validation always runs, whatever the caller's handler did.
          if (!disabled) take(event.dataTransfer.files[0]);
        }}
        // Children ignore the pointer so moving over them does not fire dragleave on the zone.
        className={cn(
          focusRing,
          'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-input bg-card px-5 py-7 text-center transition-colors enabled:hover:border-foreground enabled:hover:bg-brand-faint disabled:pointer-events-none disabled:opacity-55 aria-invalid:border-destructive/45 data-dragging:border-foreground data-dragging:bg-brand-faint [&>*]:pointer-events-none',
        )}
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
        accept={rules.length > 0 ? rules.join(',') : undefined}
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
