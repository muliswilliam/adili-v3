import {
  Alert,
  AlertDescription,
  Button,
  DateInput,
  FormField,
  Icon,
  Spinner,
  useToast,
  useIdempotencyKey,
} from '@adili/ui';
import { AlertCircleIcon, File01Icon, Mail01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useId, useState } from 'react';

import type { AccessResult } from '../../server/access-requests.server';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { actionFailure, dayAfter, formatDay, nairobiDay, noticeDayError } from './request-view';
import { Muted, SideCard } from './side-cards';

export interface WrittenNoticeCardProps {
  /** Why the notice goes on paper, naming the officer. */
  intro: string;
  /** When the officer was invited to onboard; null while the invitation is on its way. */
  invitedAt: string | null;
  /** The earliest day it may have been served (`YYYY-MM-DD`), and what that day was. */
  earliest: string;
  earliestMessage: (date: string) => string;
  /** Under the day: its bounds, in this request's words. */
  hint: string;
  /**
   * Days of the window for representations the notice opens, shown as the close date as the
   * day is entered; none for a law enforcement grant (no window).
   */
  windowDays?: number;
  now: string;
  success: string;
  record: (notifiedOn: string, idempotencyKey: string) => Promise<AccessResult<unknown>>;
}

/**
 * "Notify in writing" (spec 10 decision 2, Regulations 22(2) and 23(2)): the officer identified
 * has no Adili account, so the access officer serves the notice on paper and records the day it
 * was served, not in the future and not before `earliest`. For Form K the window for
 * representations runs from it: the day it closes shows as the day is entered.
 */
export function WrittenNoticeCard({
  intro,
  invitedAt,
  earliest,
  earliestMessage,
  hint,
  windowDays,
  now,
  success,
  record,
}: WrittenNoticeCardProps) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const today = nairobiDay(now);
  const [day, setDay] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per day sent: kept across retries of it, a new one once the day changes (the
  // service keeps a refusal under its key, so a corrected day needs its own).
  const idempotencyKey = useIdempotencyKey();
  const bounds = { today, earliest, earliestMessage };

  const closesOn = day && windowDays !== undefined ? dayAfter(day, windowDays) : null;
  const preview =
    closesOn && !noticeDayError(day, { invalid }, bounds)
      ? closesOn < today
        ? m.noticeWindowPassed(formatDay(closesOn))
        : m.noticeWindowPreview(formatDay(closesOn))
      : null;

  const submit = async () => {
    const problem = noticeDayError(day, { invalid }, bounds);
    setError(problem);
    if (problem || !day) return;
    setBusy(true);
    setFailure(null);
    const result = await record(day, idempotencyKey.keyFor(day)).catch(
      (): AccessResult<unknown> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    setBusy(false);
    if (result.ok) {
      toast({ title: success });
      await router.invalidate();
      return;
    }
    const failed = actionFailure(result.error);
    if (failed.signIn) {
      goToSignIn();
      return;
    }
    const field = result.error.kind === 'problem' ? result.error.problem : null;
    if (field?.status === 400 && field.errors?.some((each) => each.path === 'notifiedOn')) {
      setError(hint);
      return;
    }
    if (failed.stale) {
      toast({ title: failed.message, urgency: 'assertive' });
      await router.invalidate();
      return;
    }
    setFailure(failed.message);
  };

  return (
    <SideCard id="written-notice" title={m.noticeTitle}>
      <p className="text-sm leading-relaxed text-muted-foreground">{intro}</p>
      <div className="flex items-start gap-2 text-[13px] text-muted-foreground">
        <Icon icon={Mail01Icon} className="mt-0.5 size-3.5 shrink-0" />
        <span>{invitedAt ? m.invitedOn(formatDay(nairobiDay(invitedAt))) : m.invitePending}</span>
      </div>
      <form
        noValidate
        className="grid gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField
          label={m.noticeDay}
          hint={hint}
          error={error ?? undefined}
          controlId={`${id}-day`}
        >
          <DateInput
            value={day}
            today={today}
            minYear={Number(earliest.slice(0, 4))}
            maxYear={Number(today.slice(0, 4))}
            pickerLabel={m.noticeDayPicker}
            disabled={busy}
            onValueChange={(value, details) => {
              setDay(value);
              setInvalid(details.invalid && details.text.trim() !== '');
              if (error) setError(null);
            }}
          />
        </FormField>
        {preview ? (
          <div role="status">
            <Muted>{preview}</Muted>
          </div>
        ) : null}
        {failure ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? <Spinner className="size-4" /> : <Icon icon={File01Icon} />}
          {m.recordNotice}
        </Button>
      </form>
    </SideCard>
  );
}
