import {
  Button,
  cn,
  EmptyState,
  FieldError,
  FieldHint,
  formatNumber,
  Icon,
  Label,
  NoteList,
  Spinner,
  Textarea,
} from '@adili/ui';
import { PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { useId, useRef, useState } from 'react';

import { NOTE_MAX_LENGTH, noteError } from '../../../review-case/case';
import type { Note } from '../../../server/review/types';
import { messages as t } from './messages';

/**
 * The Notes tab (spec 07a FE-3): add an internal note (up to 2,000 characters) and read the
 * case's notes, newest first. The declarant never sees them.
 */
export function NotesTab({
  notes,
  viewerSubject,
  onAdd,
}: {
  notes: Note[];
  viewerSubject: string;
  /** Saves the note; resolves to an error to show, or null once saved. */
  onAdd: (text: string) => Promise<string | null>;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const over = text.length > NOTE_MAX_LENGTH;

  async function add() {
    const problem = noteError(text);
    if (problem) {
      setError(problem);
      field.current?.focus();
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
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={id}>{t.notes.label}</Label>
          <span
            aria-hidden="true"
            className={cn(
              'text-[12.5px] text-muted-foreground tabular-nums',
              over && 'font-semibold text-destructive',
            )}
          >
            {t.notes.counter(formatNumber(text.length))}
          </span>
        </div>
        <Textarea
          ref={field}
          id={id}
          rows={3}
          value={text}
          placeholder={t.notes.placeholder}
          aria-invalid={error || over ? true : undefined}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
        />
        <div className="flex items-start gap-2.5">
          <div className="flex-1">
            {error ? (
              <FieldError id={`${id}-help`}>{error}</FieldError>
            ) : (
              <FieldHint id={`${id}-help`} className="mt-0">
                {t.notes.hint}
              </FieldHint>
            )}
          </div>
          <Button size="sm" onClick={() => void add()} disabled={busy}>
            {busy ? <Spinner className="size-4" /> : null}
            {t.notes.add}
          </Button>
        </div>
      </div>
      {notes.length > 0 ? (
        <NoteList notes={notes} viewerSubject={viewerSubject} label={t.notes.list} />
      ) : (
        <EmptyState
          icon={<Icon icon={PencilEdit02Icon} />}
          title={t.notes.emptyTitle}
          description={t.notes.emptyBody}
        />
      )}
    </div>
  );
}
