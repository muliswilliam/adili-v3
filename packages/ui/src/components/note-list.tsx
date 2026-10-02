import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/format-date';
import { type Assignee, AssigneeAvatar } from './assignee-chip';

/** An internal note on a case (review.yaml `Note`). */
export interface CaseNote {
  id: string;
  author: Assignee;
  text: string;
  /** When it was added, an ISO date-time. */
  at: string;
}

export type NoteListProps = Omit<ComponentProps<'ul'>, 'children'> & {
  notes: CaseNote[];
  /** The signed-in officer's subject, whose notes get the brand initials. */
  viewerSubject?: string | null;
  /** Names the list for screen readers. */
  label?: string;
};

/**
 * Internal notes newest first, each on warm paper: the author's initials and name, when it was
 * added (Kenyan time) and the text with its line breaks. Renders nothing when there are none, so
 * the page shows its own empty state.
 */
export function NoteList({
  notes,
  viewerSubject,
  label = 'Notes',
  className,
  ...props
}: NoteListProps) {
  if (notes.length === 0) return null;
  const newestFirst = [...notes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <ul aria-label={label} className={cn('grid gap-2.5', className)} {...props}>
      {newestFirst.map((note) => (
        <li key={note.id} className="rounded-xl bg-note px-3.5 py-3 ring-1 ring-note-border">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
            <AssigneeAvatar
              name={note.author.name}
              me={Boolean(viewerSubject) && note.author.subject === viewerSubject}
            />
            <span className="font-semibold">{note.author.name}</span>
            <time dateTime={note.at} className="text-muted-foreground">
              {formatDateTime(note.at)}
            </time>
          </div>
          <p className="text-sm break-words whitespace-pre-wrap">{note.text}</p>
        </li>
      ))}
    </ul>
  );
}
