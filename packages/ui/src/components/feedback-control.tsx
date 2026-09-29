import { ThumbsDownIcon, ThumbsUpIcon } from '@hugeicons/core-free-icons';
import {
  type ComponentProps,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { FormField } from './form-field';
import { Icon } from './icon';
import { Select, SelectItem } from './select';
import { Textarea } from './textarea';
import { Tooltip } from './tooltip';

/** Why an output was not helpful, as the review and ai-gateway contracts name the reasons. */
export const FEEDBACK_REASONS = [
  'inaccurate',
  'missed-something',
  'unclear',
  'too-long',
  'other',
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackRating = 'helpful' | 'not-helpful';

/** One person's rating of one output. `reason` is set only for `not-helpful`. */
export interface Feedback {
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  note: string | null;
}

/** Longest note the contracts accept. */
export const FEEDBACK_NOTE_MAX_LENGTH = 1000;

export interface FeedbackMessages {
  helpful: string;
  notHelpful: string;
  /** Names the form that opens for "Not helpful". */
  formLabel: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  reasonRequired: string;
  reasons: Record<FeedbackReason, string>;
  noteLabel: string;
  noteHint: string;
  notePlaceholder: string;
  cancel: string;
  send: string;
  /** Announced to screen readers once a rating is sent. */
  sent: string;
  /** The read-only line: "Faith Achieng: not helpful, too long", or "Rated helpful". */
  readOnly: (feedback: Feedback, ratedBy: string | undefined, reasonName: string | null) => string;
}

const REASON_NAMES: Record<FeedbackReason, string> = {
  inaccurate: 'Inaccurate',
  'missed-something': 'Missed something',
  unclear: 'Unclear',
  'too-long': 'Too long',
  other: 'Other',
};

const DEFAULT_MESSAGES: FeedbackMessages = {
  helpful: 'Helpful',
  notHelpful: 'Not helpful',
  formLabel: 'Why was this not helpful?',
  reasonLabel: 'What was wrong?',
  reasonPlaceholder: 'Choose a reason',
  reasonRequired: 'Choose a reason.',
  reasons: REASON_NAMES,
  noteLabel: 'Note',
  noteHint: 'Optional',
  notePlaceholder: 'What should it have said?',
  cancel: 'Cancel',
  send: 'Send rating',
  sent: 'Rating sent. Thank you.',
  readOnly: ({ rating }, ratedBy, reasonName) => {
    const text = `${rating === 'helpful' ? 'helpful' : 'not helpful'}${reasonName ? `, ${reasonName.toLowerCase()}` : ''}`;
    return ratedBy ? `${ratedBy}: ${text}` : `Rated ${text}`;
  },
};

export type FeedbackControlProps = Omit<ComponentProps<'div'>, 'children' | 'onChange'> & {
  /** The rating already given, or null. */
  value: Feedback | null;
  /** Called with a new rating. Hold it in `value` once it is saved. */
  onRate?: (feedback: Feedback) => void;
  /** Shows the rating as text, for someone who can read but not rate (a supervisor). */
  readOnly?: boolean;
  /** Who gave the rating, for the read-only line. */
  ratedBy?: string;
  /** Names the pair of buttons. Defaults to "Rate this output". */
  label?: string;
  /** Turns the buttons off, e.g. while a rating is being saved. */
  disabled?: boolean;
  messages?: Partial<FeedbackMessages>;
};

const rateButtonClassName =
  'size-7 rounded-lg text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground [&_svg]:size-[15px]';

/**
 * Lets a reviewer rate an AI output. "Helpful" is sent in one press; "Not helpful" opens a form
 * under the buttons asking what was wrong (Inaccurate, Missed something, Unclear, Too long,
 * Other) with an optional note, sent with "Send rating". One rating per person per output:
 * rating again replaces it, and a sent "Not helpful" reopens with its reason to change it. Both
 * buttons are labelled and show their state in `aria-pressed`; sending is announced politely.
 */
export function FeedbackControl({
  value,
  onRate,
  readOnly = false,
  ratedBy,
  label = 'Rate this output',
  disabled = false,
  messages,
  className,
  ...props
}: FeedbackControlProps) {
  const copy = { ...DEFAULT_MESSAGES, ...messages };
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | ''>('');
  const [note, setNote] = useState('');
  const [missingReason, setMissingReason] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const reasonRef = useRef<HTMLButtonElement>(null);
  const notHelpfulRef = useRef<HTMLButtonElement>(null);
  // Set when the form closes from inside it, so focus goes back to the button that opened it.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open) {
      reasonRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      notHelpfulRef.current?.focus();
    }
  }, [open]);

  if (readOnly) {
    if (!value) return null;
    const reasonName = value.reason ? copy.reasons[value.reason] : null;
    return (
      <div
        className={cn(
          'inline-flex items-center gap-[5px] text-[12.5px] text-muted-foreground [&_svg]:size-[13px]',
          className,
        )}
        {...props}
      >
        <Icon icon={value.rating === 'helpful' ? ThumbsUpIcon : ThumbsDownIcon} />
        <span>{copy.readOnly(value, ratedBy, reasonName)}</span>
      </div>
    );
  }

  function rate(feedback: Feedback) {
    onRate?.(feedback);
    setAnnouncement(copy.sent);
  }

  function openForm() {
    setReason(value?.rating === 'not-helpful' ? (value.reason ?? '') : '');
    setNote(value?.rating === 'not-helpful' ? (value.note ?? '') : '');
    setMissingReason(false);
    setOpen(true);
  }

  function closeForm() {
    returnFocus.current = true;
    setOpen(false);
  }

  function send(event: SyntheticEvent) {
    event.preventDefault();
    if (!reason) {
      setMissingReason(true);
      reasonRef.current?.focus();
      return;
    }
    rate({ rating: 'not-helpful', reason, note: note.trim() || null });
    closeForm();
  }

  return (
    <div className={cn('flex flex-col items-end gap-2', className)} {...props}>
      <div role="group" aria-label={label} className="inline-flex items-center gap-0.5">
        <Tooltip content={copy.helpful}>
          <Button
            variant="ghost"
            size="icon"
            className={rateButtonClassName}
            aria-pressed={!open && value?.rating === 'helpful'}
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              if (value?.rating !== 'helpful')
                rate({ rating: 'helpful', reason: null, note: null });
            }}
          >
            <Icon icon={ThumbsUpIcon} />
            <span className="sr-only">{copy.helpful}</span>
          </Button>
        </Tooltip>
        <Tooltip content={copy.notHelpful}>
          <Button
            ref={notHelpfulRef}
            variant="ghost"
            size="icon"
            className={rateButtonClassName}
            aria-pressed={open || value?.rating === 'not-helpful'}
            aria-expanded={open}
            aria-controls={open ? formId : undefined}
            disabled={disabled}
            onClick={() => {
              if (open) setOpen(false);
              else openForm();
            }}
          >
            <Icon icon={ThumbsDownIcon} />
            <span className="sr-only">{copy.notHelpful}</span>
          </Button>
        </Tooltip>
      </div>
      {open ? (
        <form
          id={formId}
          aria-label={copy.formLabel}
          noValidate
          onSubmit={send}
          className="grid gap-2.5 self-stretch rounded-[10px] bg-muted p-3"
        >
          <FormField
            label={copy.reasonLabel}
            error={missingReason ? copy.reasonRequired : undefined}
          >
            <Select
              ref={reasonRef}
              value={reason}
              onValueChange={(next) => {
                setReason(next as FeedbackReason);
                setMissingReason(false);
              }}
              placeholder={copy.reasonPlaceholder}
              className="bg-card"
            >
              {FEEDBACK_REASONS.map((key) => (
                <SelectItem key={key} value={key}>
                  {copy.reasons[key]}
                </SelectItem>
              ))}
            </Select>
          </FormField>
          <FormField label={copy.noteLabel} hint={copy.noteHint}>
            <Textarea
              rows={2}
              maxLength={FEEDBACK_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              placeholder={copy.notePlaceholder}
              className="min-h-0 bg-card"
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={closeForm}>
              {copy.cancel}
            </Button>
            <Button type="submit" size="sm">
              {copy.send}
            </Button>
          </div>
        </form>
      ) : null}
      <div role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
