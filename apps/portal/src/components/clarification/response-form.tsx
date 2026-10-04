import {
  Alert,
  AlertDescription,
  AttachmentList,
  Button,
  DescriptionItem,
  DescriptionList,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  formatDate,
  Icon,
  Label,
  daysBetween,
  Spinner,
  Textarea,
} from '@adili/ui';
import { Clock01Icon, SentIcon, WifiOff01Icon } from '@hugeicons/core-free-icons';
import { type Dispatch, useReducer } from 'react';

import { COPY } from '../../clarification/copy';
import { lateDays } from '../../clarification/deadline';
import {
  answeredCount,
  attachedCount,
  attachmentRowsFor,
  filesChecking,
  itemError,
  newResponseForm,
  pointKey,
  RESPONSE_MAX_CHARS,
  RESPONSE_MAX_FILES,
  type ResponseEvent,
  type ResponseForm,
  responseFormReducer,
} from '../../clarification/response-form';
import type { DeclarantClarification } from '../../server/review/types';
import { useResponseUploads } from '../response-uploads';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES } from '../declaration/attachments';

/**
 * The pieces of the declarant's answer to an open clarification (spec 07a S14, S20): the answer
 * box and documents under each point, the bar that submits, and the confirmation that it goes
 * once. The page (`clarification-page.tsx`) owns sending it.
 */

export interface ResponseFormState {
  form: ResponseForm;
  dispatch: Dispatch<ResponseEvent>;
  /** Lists a picked file under a point and, unless the browser refused it, uploads it. */
  attach: (index: number, file: File, rejection: 'type' | 'size' | null) => void;
  retry: (rowId: string) => void;
}

export function useResponseForm(points: number): ResponseFormState {
  const [form, dispatch] = useReducer(responseFormReducer, points, newResponseForm);
  const uploads = useResponseUploads('clarification-attachment', dispatch);
  return {
    form,
    dispatch,
    attach: (index, file, rejection) => {
      uploads.attach(pointKey(index), file, rejection);
    },
    retry: uploads.retry,
  };
}

/** The answer box and documents under one point. */
export function PointAnswer({
  index,
  placeholder,
  state,
}: {
  index: number;
  placeholder: string;
  state: ResponseFormState;
}) {
  const { form, dispatch } = state;
  const n = index + 1;
  const text = form.texts[index] ?? '';
  const error = itemError(form, index);
  const textId = `point-${String(n)}-response`;
  const errorId = `${textId}-error`;
  const rows = attachmentRowsFor(form, index);
  const full = rows.length >= RESPONSE_MAX_FILES;
  return (
    <div className="grid gap-3 rounded-lg bg-muted p-4">
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={textId}>
            {COPY.yourResponse}
            <span className="sr-only"> to point {n}</span>
          </Label>
          <span
            className={
              text.length > RESPONSE_MAX_CHARS
                ? 'text-xs font-medium text-destructive'
                : 'text-xs text-muted-foreground'
            }
          >
            {COPY.counter(text.length)}
          </span>
        </div>
        <Textarea
          id={textId}
          rows={4}
          value={text}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            dispatch({ type: 'typed', index, text: event.target.value });
          }}
        />
        {error ? (
          <FieldError id={errorId}>{error === 'missing' ? COPY.missing : COPY.tooLong}</FieldError>
        ) : null}
      </div>
      <AttachmentList
        label={COPY.documentsFor(n)}
        attachments={rows}
        accept={ATTACHMENT_ACCEPT}
        maxSize={ATTACHMENT_MAX_BYTES}
        addLabel={COPY.attach}
        addHint={full ? COPY.attachLimit : COPY.attachHint}
        messages={{ removeBody: COPY.removeBody }}
        {...(full
          ? {}
          : {
              onAdd: (file: File, rejection: 'type' | 'size' | null) => {
                state.attach(index, file, rejection);
              },
            })}
        onRetry={(row) => {
          state.retry(row.id);
        }}
        onDismiss={(row) => {
          dispatch({ type: 'dismissed', id: row.id });
        }}
        onRemove={(row) => {
          dispatch({ type: 'removed', id: row.id });
        }}
      />
    </div>
  );
}

export type SubmitError = 'network' | 'signed-out' | null;

/** "2 of 3 points answered", the send error if any, and Submit response. */
export function SubmitBar({
  form,
  points,
  error,
  signInHref,
  onSubmit,
}: {
  form: ResponseForm;
  points: number;
  error: SubmitError;
  signInHref: string;
  onSubmit: () => void;
}) {
  const checking = filesChecking(form);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t px-5 py-4">
      <p aria-live="polite" className="text-sm">
        <span className="font-semibold">{COPY.answered(answeredCount(form), points)}</span>
      </p>
      <Button className="ml-auto" disabled={checking} onClick={onSubmit}>
        {checking ? <Spinner /> : <Icon icon={SentIcon} />}
        {checking ? COPY.checkingFiles : COPY.submit}
      </Button>
      {error ? (
        <p role="alert" className="flex basis-full items-start gap-2 text-sm text-destructive">
          <Icon icon={WifiOff01Icon} className="mt-0.5 size-4 shrink-0" />
          <span>
            {error === 'network' ? COPY.networkError : COPY.signedOut}{' '}
            {error === 'signed-out' ? (
              <a className="font-medium underline" href={signInHref}>
                {COPY.signIn}
              </a>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** "Submit your response?" with what is being sent, and how late when past the due date. */
export function ConfirmResponseDialog({
  open,
  busy,
  clarification,
  form,
  now,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  clarification: DeclarantClarification;
  form: ResponseForm;
  now: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { dueAt } = clarification;
  const late = dueAt !== null && daysBetween(now, dueAt) < 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>{COPY.confirmTitle}</DialogTitle>
          <DialogDescription>{COPY.confirmBody}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <DescriptionList>
            <DescriptionItem term={COPY.confirmClarification}>
              <span className="font-mono">{clarification.reference}</span>
            </DescriptionItem>
            <DescriptionItem term={COPY.confirmPoints}>
              {`${String(answeredCount(form))} of ${String(clarification.items.length)}`}
            </DescriptionItem>
            <DescriptionItem term={COPY.confirmDocuments}>{attachedCount(form)}</DescriptionItem>
          </DescriptionList>
          {late ? (
            <Alert variant="warning" role="note">
              <Icon icon={Clock01Icon} />
              <AlertDescription>
                {COPY.confirmLate(formatDate(dueAt), lateDays(dueAt, now))}
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{COPY.checkAgain}</Button>
          </DialogClose>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner /> : null}
            {busy ? COPY.sending : COPY.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
