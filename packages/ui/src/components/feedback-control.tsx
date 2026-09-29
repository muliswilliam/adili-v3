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
  /** Names the pair of buttons, e.g. "Rate the summary". */
  group: string;
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
  /** Announced to screen readers once a rating is saved. */
  sent: string;
  /** Announced when saving fails; the form stays open with what was entered. */
  failed: string;
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
  group: 'Rate this output',
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
  failed: 'Rating not sent. Try again.',
  readOnly: ({ rating }, ratedBy, reasonName) => {
    const text = `${rating === 'helpful' ? 'helpful' : 'not helpful'}${reasonName ? `, ${reasonName.toLowerCase()}` : ''}`;
    return ratedBy ? `${ratedBy}: ${text}` : `Rated ${text}`;
  },
};

export type FeedbackControlProps = Omit<ComponentProps<'div'>, 'children' | 'onChange'> & {
  /** The rating already given, or null. */
  value: Feedback | null;
  /**
   * Called with a new rating; hold it in `value` once it is saved. Return a promise to keep the
   * control busy until the save ends: the form closes and "Rating sent" is announced only when
   * it resolves, and a rejection keeps the form open with what was entered.
   */
  onRate?: (feedback: Feedback) => void | Promise<void>;
  /** Shows the rating as text, for someone who can read but not rate (a supervisor). */
  readOnly?: boolean;
  /** Who gave the rating, for the read-only line. */
  ratedBy?: string;
  /** Turns the buttons and the form off. */
  disabled?: boolean;
  messages?: Partial<FeedbackMessages>;
};

const rateButtonClassName =
  'size-7 text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground [&_svg]:size-[15px]';

/**
 * Lets a reviewer rate an AI output. "Helpful" is sent in one press; "Not helpful" opens a form
 * under the buttons asking what was wrong (Inaccurate, Missed something, Unclear, Too long,
 * Other) with an optional note, sent with "Send rating". One rating per person per output:
 * rating again replaces it, and a sent "Not helpful" reopens with its reason to change it. Both
 * buttons are labelled and show their state in `aria-pressed`; saving is announced politely.
 */
export function FeedbackControl({
  value,
  onRate,
  readOnly = false,
  ratedBy,
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
  const [saving, setSaving] = useState(false);
  const busy = disabled || saving;
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

  // A live region only speaks when its text changes, so the same message twice in a row gets a
  // trailing no-break space to be read again.
  function announce(text: string) {
    setAnnouncement((previous) => (previous === text ? `${text}\u00a0` : text));
  }

  /** Saves a rating; resolves true once it is saved. */
  async function rate(feedback: Feedback): Promise<boolean> {
    setSaving(true);
    try {
      await onRate?.(feedback);
      announce(copy.sent);
      return true;
    } catch {
      announce(copy.failed);
      return false;
    } finally {
      setSaving(false);
    }
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

  async function send(event: SyntheticEvent) {
    event.preventDefault();
    if (!reason) {
      setMissingReason(true);
      reasonRef.current?.focus();
      return;
    }
    if (await rate({ rating: 'not-helpful', reason, note: note.trim() || null })) closeForm();
  }

  return (
    <div className={cn('flex flex-col items-end gap-2', className)} {...props}>
      <div role="group" aria-label={copy.group} className="inline-flex items-center gap-0.5">
        <Tooltip content={copy.helpful}>
          <Button
            variant="ghost"
            size="icon"
            className={rateButtonClassName}
            aria-pressed={!open && value?.rating === 'helpful'}
            disabled={busy}
            onClick={() => {
              setOpen(false);
              if (value?.rating !== 'helpful')
                void rate({ rating: 'helpful', reason: null, note: null });
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
            disabled={busy}
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
          onSubmit={(event) => {
            void send(event);
          }}
          className="self-stretch rounded-lg bg-muted p-3"
        >
          <fieldset disabled={busy} className="grid min-w-0 gap-2.5">
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
          </fieldset>
        </form>
      ) : null}
      <div role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
