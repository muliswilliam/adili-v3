import {
  AttachmentList,
  Badge,
  Button,
  Card,
  CardTitle,
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
  formatDateTime,
  Icon,
  Label,
  RadioCard,
  RadioGroup,
  Spinner,
  Textarea,
} from '@adili/ui';
import {
  Cancel01Icon,
  File02Icon,
  Message01Icon,
  PencilEdit02Icon,
  SentIcon,
  Tick02Icon,
  WifiOff01Icon,
} from '@hugeicons/core-free-icons';
import { type Dispatch, useReducer, useState } from 'react';

import { RESPONSE_COPY as COPY, STANCES } from '../../access/notice-copy';
import { scopeLine } from '../../access/notices';
import {
  attachmentRows,
  filesChecking,
  newRepresentationForm,
  REPRESENTATION_MAX_CHARS,
  REPRESENTATION_MAX_FILES,
  type RepresentationEvent,
  type RepresentationForm,
  representationReducer,
  stanceError,
  textError,
} from '../../access/representation-form';
import type {
  FormKDeclarantNotice,
  Representations,
  RepresentationStance,
} from '../../server/access/types';
import {
  completeAttachmentUpload,
  createAttachmentUpload,
  getAttachmentUpload,
} from '../../server/documents/uploads';
import {
  putToPresignedUrl,
  uploadAttachment,
  type UploadSteps,
} from '../declaration/attachment-upload';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES } from '../declaration/attachments';

/**
 * The declarant's representations on an access request (spec 10 S4): the form (stance, text,
 * documents) while the window is open, the response once sent, and the confirmation before
 * consenting. The page (`notice-page.tsx`) owns sending it.
 */

const STANCE_ICONS = { object: Cancel01Icon, consent: Tick02Icon, context: Message01Icon };
const STANCE_ORDER: RepresentationStance[] = ['object', 'consent', 'context'];

export interface RepresentationFormState {
  form: RepresentationForm;
  dispatch: Dispatch<RepresentationEvent>;
  attach: (file: File, rejection: 'type' | 'size' | null) => void;
  retry: (rowId: string) => void;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** The form's state, from blank or from the response being edited, and its uploads. */
export function useRepresentationForm(sent: Representations | null): RepresentationFormState {
  const [form, dispatch] = useReducer(representationReducer, sent, newRepresentationForm);
  // The picked files by row id, to upload a failed one again.
  const [files] = useState(() => new Map<string, File>());

  function start(rowId: string, file: File) {
    const steps: UploadSteps = {
      reserve: (picked) =>
        createAttachmentUpload({ data: { ...picked, purpose: 'access-representation' } }),
      put: putToPresignedUrl,
      complete: (uploadId) => completeAttachmentUpload({ data: { uploadId } }),
      check: (uploadId) => getAttachmentUpload({ data: { uploadId } }),
      // The access service links the files when the response is saved; nothing to link here.
      link: () => Promise.resolve({ status: 'linked', size: file.size }),
      wait,
    };
    void uploadAttachment(rowId, file, steps, (event) => {
      if (event.type === 'linked') files.delete(rowId);
      dispatch(event);
    });
  }

  return {
    form,
    dispatch,
    attach: (file, rejection) => {
      const rowId = crypto.randomUUID();
      dispatch({
        type: 'picked',
        id: rowId,
        itemId: 'representations',
        name: file.name,
        size: file.size,
        rejection,
      });
      if (rejection) return;
      files.set(rowId, file);
      start(rowId, file);
    },
    retry: (rowId) => {
      const file = files.get(rowId);
      if (!file) return;
      dispatch({ type: 'retry', id: rowId });
      start(rowId, file);
    },
  };
}

function textLabel(stance: RepresentationStance, commission: string): string {
  if (stance === 'object') return COPY.objectLabel;
  if (stance === 'context') return COPY.contextLabel(commission);
  return COPY.consentLabel;
}

const PLACEHOLDERS: Record<RepresentationStance, string> = {
  object: COPY.objectPlaceholder,
  context: COPY.contextPlaceholder,
  consent: COPY.consentPlaceholder,
};

export type SendError = 'network' | 'signed-out' | null;

/**
 * The form: the stance as three tiles, then the text (required to object or add context, optional
 * with consent) and up to ten documents. `disabled` after the window closed while editing.
 */
export function RepresentationFormCard({
  notice,
  state,
  editing,
  disabled,
  busy,
  error,
  signInHref,
  onSubmit,
  onCancel,
}: {
  notice: FormKDeclarantNotice;
  state: RepresentationFormState;
  /** Changing a sent response: Save changes and Cancel. */
  editing: boolean;
  disabled: boolean;
  busy: boolean;
  error: SendError;
  signInHref: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { form, dispatch } = state;
  const { stance } = form;
  const textId = `representations-${notice.requestId}`;
  const errorId = `${textId}-error`;
  const problem = textError(form);
  const rows = attachmentRows(form);
  const full = rows.length >= REPRESENTATION_MAX_FILES;
  const checking = filesChecking(form);
  return (
    <Card className="gap-0 p-0 sm:p-0">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <CardTitle>{COPY.title}</CardTitle>
      </div>
      <fieldset disabled={disabled} className="grid min-w-0 gap-5 px-5 py-5 sm:px-6">
        <RadioGroup
          legend={COPY.position}
          columns={3}
          error={stanceError(form) ? COPY.stanceMissing : undefined}
        >
          {STANCE_ORDER.map((each) => (
            <RadioCard
              key={each}
              layout="tile"
              name={`stance-${notice.requestId}`}
              value={each}
              checked={stance === each}
              onChange={() => {
                dispatch({ type: 'stance', stance: each });
              }}
              label={STANCES[each].label.en}
              description={STANCES[each].hint.en}
              icon={<Icon icon={STANCE_ICONS[each]} />}
            />
          ))}
        </RadioGroup>
        {stance ? (
          <>
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={textId}>
                  {textLabel(stance, notice.commission.name)}
                  {stance === 'consent' ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {COPY.optional}
                    </span>
                  ) : null}
                </Label>
                <span
                  className={
                    form.text.length > REPRESENTATION_MAX_CHARS
                      ? 'text-xs font-medium text-destructive tabular-nums'
                      : 'text-xs text-muted-foreground tabular-nums'
                  }
                >
                  {COPY.counter(form.text.length, REPRESENTATION_MAX_CHARS)}
                </span>
              </div>
              <Textarea
                id={textId}
                rows={5}
                value={form.text}
                placeholder={PLACEHOLDERS[stance]}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errorId : undefined}
                onChange={(event) => {
                  dispatch({ type: 'typed', text: event.target.value });
                }}
              />
              {problem ? (
                <FieldError id={errorId}>
                  {problem === 'too-long'
                    ? COPY.tooLong(REPRESENTATION_MAX_CHARS)
                    : stance === 'object'
                      ? COPY.objectMissing
                      : COPY.contextMissing}
                </FieldError>
              ) : null}
            </div>
            <AttachmentList
              label={COPY.documents}
              attachments={rows}
              accept={ATTACHMENT_ACCEPT}
              maxSize={ATTACHMENT_MAX_BYTES}
              addLabel={rows.length > 0 ? COPY.attachAnother : COPY.attach}
              addHint={full ? COPY.attachLimit(REPRESENTATION_MAX_FILES) : COPY.attachHint}
              messages={{ removeBody: COPY.removeBody }}
              {...(full || disabled
                ? {}
                : {
                    onAdd: (file: File, rejection: 'type' | 'size' | null) => {
                      state.attach(file, rejection);
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
          </>
        ) : null}
      </fieldset>
      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4 sm:px-6">
          {notice.windowEndsAt ? (
            <span className="text-sm text-muted-foreground">
              {COPY.editableUntil(formatDateTime(notice.windowEndsAt))}
            </span>
          ) : null}
          <span className="flex-1" />
          {editing ? (
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              {COPY.cancel}
            </Button>
          ) : null}
          <Button disabled={checking || busy} onClick={onSubmit}>
            {busy || checking ? <Spinner /> : editing ? null : <Icon icon={SentIcon} />}
            {busy
              ? COPY.saving
              : checking
                ? COPY.checkingFiles
                : editing
                  ? COPY.saveChanges
                  : COPY.send}
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
      )}
    </Card>
  );
}

/** The response as sent: the stance, when, the text and the documents; Edit while open. */
export function SentResponseCard({
  representations,
  canEdit,
  onEdit,
}: {
  representations: Representations;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { stance, text, attachments, submittedAt, updatedAt } = representations;
  const edited = updatedAt !== submittedAt;
  return (
    <Card className="gap-0 p-0 sm:p-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5 sm:px-6">
        <CardTitle className="flex-1">{COPY.title}</CardTitle>
        {canEdit ? (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Icon icon={PencilEdit02Icon} />
            {COPY.edit}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">
            <Icon icon={STANCE_ICONS[stance]} strokeWidth={2.2} />
            {STANCES[stance].done.en}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {edited
              ? COPY.editedAt(formatDateTime(updatedAt))
              : COPY.sentAt(formatDateTime(submittedAt))}
          </span>
        </div>
        {text ? (
          <p className="rounded-lg bg-muted p-4 text-[14.5px] break-words whitespace-pre-line">
            {text}
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <ul className="grid gap-1.5" aria-label={COPY.documents}>
            {attachments.map((file) => (
              <li key={file.uploadId} className="flex items-center gap-2 text-sm">
                <Icon icon={File02Icon} className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">{file.fileName}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

/** "Consent to release?" before a consent goes: it closes the window at once. */
export function ConsentDialog({
  open,
  busy,
  notice,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  notice: FormKDeclarantNotice;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>{COPY.consentTitle}</DialogTitle>
          <DialogDescription>{COPY.consentBody(notice.commission.name)}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <DescriptionList>
            <DescriptionItem term={COPY.consentApplicant}>{notice.applicantName}</DescriptionItem>
            <DescriptionItem term={COPY.consentScope}>{scopeLine(notice.scope)}</DescriptionItem>
          </DescriptionList>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {COPY.cancel}
            </Button>
          </DialogClose>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner /> : null}
            {busy ? COPY.sending : COPY.consentConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The toast after a save. */
export function savedToast(notice: FormKDeclarantNotice, first: boolean): string {
  if (notice.representations?.stance === 'consent') return COPY.sentConsent(notice.commission.name);
  if (first && notice.windowEndsAt) {
    return COPY.sentFirst(notice.commission.name, formatDate(notice.windowEndsAt));
  }
  return COPY.changesSaved;
}
