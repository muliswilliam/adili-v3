import {
  Button,
  cn,
  EmptyState,
  FieldError,
  formatNumber,
  Icon,
  Label,
  NoteList,
  Spinner,
  Textarea,
} from '@adili/ui';
import { PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import { CASE_COPY } from '../../../review-case/messages';
import type { Note } from '../../../server/review/types';

const copy = CASE_COPY.notes;

/** What is wrong with a note before it is sent, or null. */
export function noteError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return copy.required;
  if (trimmed.length > copy.max) return copy.tooLong;
  return null;
}

/**
 * The Notes tab (spec 07a FE-3): "Add note" (up to 2,000 characters, with a counter) and the
 * case's internal notes, newest first, with author and time. Any reviewer or supervisor of the
 * Commission may add one; the declarant never sees them.
 */
export function NotesTab({
  notes,
  subject,
  onAdd,
}: {
  notes: readonly Note[];
  subject: string;
  /** Resolves to an error to show, or null once the note is saved. */
  onAdd: (text: string) => Promise<string | null>;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const over = text.length > copy.max;

  async function add() {
    const problem = noteError(text);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const failed = await onAdd(text.trim());
    setBusy(false);
    setError(failed);
    if (!failed) setText('');
  }

  return (
    <div className="grid gap-3.5">
      <form
        className="grid gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={id}>{copy.label}</Label>
          <span
            id={`${id}-count`}
            aria-live="polite"
            className={cn(
              'text-[12.5px] text-muted-foreground tabular-nums',
              over && 'font-semibold text-destructive',
            )}
          >
            {formatNumber(text.length)} / {formatNumber(copy.max)}
          </span>
        </div>
        <Textarea
          id={id}
          rows={3}
          value={text}
          placeholder={copy.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? `${id}-error` : null, `${id}-hint`, `${id}-count`]
            .filter(Boolean)
            .join(' ')}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
        />
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
        <div className="flex items-start gap-2.5">
          <p id={`${id}-hint`} className="flex-1 text-[13px] text-muted-foreground">
            {copy.hint}
          </p>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Spinner /> : null}
            {copy.add}
          </Button>
        </div>
      </form>
      <NoteList
        notes={notes.map((note) => ({
          id: note.id,
          author: note.author.name,
          current: note.author.subject === subject,
          at: note.at,
          text: note.text,
        }))}
        empty={
          <EmptyState
            icon={<Icon icon={PencilEdit02Icon} />}
            title={copy.emptyTitle}
            description={copy.emptyBody}
          />
        }
      />
    </div>
  );
}
