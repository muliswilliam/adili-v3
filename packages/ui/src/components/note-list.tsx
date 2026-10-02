import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/format-date';
import { Avatar } from './avatar';

export interface Note {
  id: string;
  /** Who wrote it. */
  author: string;
  /** The author is the signed-in user, for the brand avatar. */
  current?: boolean;
  /** When it was written, an ISO date-time. */
  at: string;
  /** Plain text; its line breaks are kept. */
  text: string;
}

export type NoteListProps = Omit<ComponentProps<'ul'>, 'children'> & {
  notes: Note[];
  /** Names the list for screen readers. */
  label?: string;
  /** Shown instead of the list when there are no notes, e.g. an `EmptyState`. */
  empty?: ReactNode;
};

/**
 * Internal notes, newest first, each on a warm paper fill: the author's avatar and name, when
 * it was written (Kenyan time), then the text with its line breaks.
 */
export function NoteList({ notes, label = 'Notes', empty, className, ...props }: NoteListProps) {
  if (notes.length === 0) return empty ?? null;

  return (
    <ul aria-label={label} className={cn('grid gap-2.5', className)} {...props}>
      {[...notes]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .map((note) => (
          <li key={note.id} className="rounded-xl bg-note px-3.5 py-3 ring-1 ring-note-border">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
              <Avatar name={note.author} current={note.current} />
              <span className="font-semibold">{note.author}</span>
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
