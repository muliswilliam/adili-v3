import {
  Alert,
  AlertDescription,
  AlertTitle,
  AttachmentList,
  Button,
  Card,
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
  ProgressBar,
  Spinner,
  Textarea,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  Calendar03Icon,
  Download01Icon,
  File02Icon,
  InformationCircleIcon,
  Notification01Icon,
  SentIcon,
  Tick02Icon,
  WifiOff01Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useReducer, useRef, useState } from 'react';

import {
  attachmentRowsFor,
  filesChecking,
  newResponseForm,
  pointKey,
  responseFormReducer,
  RESPONSE_MAX_FILES,
} from '../../clarification/response-form';
import { COPY, STEP_TITLES } from '../../notices/copy';
import { canRespond, isClosed, ladderNotices, ladderOf, windowOf } from '../../notices/view';
import {
  completeAttachmentUpload,
  createAttachmentUpload,
  getAttachmentUpload,
} from '../../server/documents/uploads';
import { respondToMyNotice } from '../../server/notices';
import type { DeclarantNotice } from '../../server/review/types';
import {
  putToPresignedUrl,
  uploadAttachment,
  type UploadSteps,
} from '../declaration/attachment-upload';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES } from '../declaration/attachments';
import { loginHref } from '../sign-in';
import { ComplyLink, LadderStrip, NoticeStatusBadge } from './notices-view';

/**
 * A notice to comply or a warning as the declarant sees it (spec 08 FE-7, S9, S17): by when to
 * act and how, what happened, their one response (the form while it is open), the window, the
 * letter and where the ladder stands.
 */

/** review.yaml `respondToNotice`: up to 4,000 characters. */
export const NOTICE_RESPONSE_MAX_CHARS = 4000;

export interface NoticePageProps {
  notice: DeclarantNotice;
  /** Every notice of the declarant, for the ladder and the history. */
  all: readonly DeclarantNotice[];
  /** The server's clock when the page loaded. */
  now: string;
}

/** The Commission as letters short-name it ("TSC"). */
const shortName = (notice: DeclarantNotice) => notice.commission.slug.toUpperCase();

export function NoticePage(props: NoticePageProps) {
  // A sent response replaces the loaded notice without a reload.
  const [notice, setNotice] = useState(props.notice);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const all = props.all.map((each) => (each.actionId === notice.actionId ? notice : each));
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
        <Link to="/notices">
          <Icon icon={ArrowLeft01Icon} />
          {COPY.back}
        </Link>
      </Button>
      <div className="grid gap-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {STEP_TITLES[notice.step]}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[13px] font-semibold text-foreground">
            {notice.reference}
          </span>
          <NoticeStatusBadge notice={notice} />
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={Calendar03Icon} className="size-4" />
            {COPY.issuedOn(formatDate(notice.issuedAt))}
          </span>
          <span>{notice.commission.name}</span>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          <Banner notice={notice} now={props.now} />
          <Card className="p-0 sm:p-0">
            <h2 className="border-b px-5 py-4 text-base font-semibold">{COPY.whatHappened}</h2>
            <p className="px-5 py-4">{COPY.happened[notice.whatToDo]}</p>
          </Card>
          {canRespond(notice) ? (
            <RespondForm
              notice={notice}
              onResponded={(responded) => {
                setNotice(responded);
                requestAnimationFrame(() => headingRef.current?.focus());
              }}
            />
          ) : notice.response ? (
            <ResponseCard response={notice.response} />
          ) : null}
        </div>
        <aside className="grid content-start gap-4">
          <WindowCard notice={notice} now={props.now} />
          <LetterCard notice={notice} />
          <HistoryCard notice={notice} all={all} />
        </aside>
      </div>
    </main>
  );
}

function Banner({ notice, now }: { notice: DeclarantNotice; now: string }) {
  if (notice.salaryReinstatedAt) {
    return (
      <Alert variant="success" role="status">
        <Icon icon={Tick02Icon} />
        <AlertTitle>{COPY.salaryReinstated(formatDate(notice.salaryReinstatedAt))}</AlertTitle>
      </Alert>
    );
  }
  if (isClosed(notice)) {
    return (
      <Alert variant="success" role="status">
        <Icon icon={Tick02Icon} />
        <AlertTitle>
          {notice.status === 'complied' ? COPY.compliedBanner : COPY.closedBanner}
        </AlertTitle>
      </Alert>
    );
  }
  if (notice.salaryStoppedAt) {
    return (
      <Alert variant="destructive" role="status">
        <Icon icon={AlertCircleIcon} />
        <AlertTitle>{COPY.salaryStopped}</AlertTitle>
        <AlertDescription className="mt-2.5">
          <ComplyLink notice={notice} />
        </AlertDescription>
      </Alert>
    );
  }
  if (notice.status === 'responded') {
    return (
      <Alert variant="info" role="status">
        <Icon icon={SentIcon} />
        <AlertTitle className="font-normal">
          <span className="font-semibold">{COPY.respondedBanner}</span>
          {COPY.respondedBody(notice.whatToDo)}
        </AlertTitle>
        <AlertDescription className="mt-2.5">
          <ComplyLink notice={notice} />
        </AlertDescription>
      </Alert>
    );
  }
  const window = windowOf(notice, now);
  const afterNotice = notice.step !== 'notice-to-comply';
  return (
    <Alert variant={afterNotice ? 'destructive' : 'warning'} role="status">
      <Icon icon={afterNotice ? AlertCircleIcon : Notification01Icon} />
      <AlertTitle className="font-normal">
        {window && notice.actBy ? (
          <span className="font-semibold">
            {COPY.actByBanner(formatDate(notice.actBy), Math.max(0, window.daysLeft))}
          </span>
        ) : null}{' '}
        {COPY.todo[notice.whatToDo]} {COPY.consequence(notice.step, shortName(notice))}
      </AlertTitle>
      <AlertDescription className="mt-2.5">
        <ComplyLink notice={notice} />
      </AlertDescription>
    </Alert>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** The notice's one response: a text and documents uploaded as `action-response`. */
function useNoticeResponse() {
  const [form, dispatch] = useReducer(responseFormReducer, 1, newResponseForm);
  const [files] = useState(() => new Map<string, File>());

  function start(rowId: string, file: File) {
    const steps: UploadSteps = {
      reserve: (picked) =>
        createAttachmentUpload({ data: { ...picked, purpose: 'action-response' } }),
      put: putToPresignedUrl,
      complete: (uploadId) => completeAttachmentUpload({ data: { uploadId } }),
      check: (uploadId) => getAttachmentUpload({ data: { uploadId } }),
      // Tied to the notice when the response is sent; nothing to link before.
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
    attach: (file: File, rejection: 'type' | 'size' | null) => {
      const rowId = crypto.randomUUID();
      dispatch({
        type: 'picked',
        id: rowId,
        itemId: pointKey(0),
        name: file.name,
        size: file.size,
        rejection,
      });
      if (rejection) return;
      files.set(rowId, file);
      start(rowId, file);
    },
    retry: (rowId: string) => {
      const file = files.get(rowId);
      if (!file) return;
      dispatch({ type: 'retry', id: rowId });
      start(rowId, file);
    },
  };
}

type SendError = 'network' | 'signed-out' | null;

function RespondForm({
  notice,
  onResponded,
}: {
  notice: DeclarantNotice;
  onResponded: (notice: DeclarantNotice) => void;
}) {
  const state = useNoticeResponse();
  const { form, dispatch } = state;
  const { toast } = useToast();
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const text = form.texts[0] ?? '';
  const tooLong = text.length > NOTICE_RESPONSE_MAX_CHARS;
  const missing = form.tried && !text.trim();
  const rows = attachmentRowsFor(form, 0);
  const full = rows.length >= RESPONSE_MAX_FILES;
  const checking = filesChecking(form);
  const textId = 'notice-response';
  const errorId = `${textId}-error`;

  function submit() {
    dispatch({ type: 'tried' });
    setError(null);
    if (!text.trim() || tooLong) {
      textRef.current?.focus();
      return;
    }
    if (checking) {
      toast({ title: COPY.filesStillChecking });
      return;
    }
    if (form.files.some((file) => file.status !== 'linked')) {
      toast({ title: COPY.filesNotAccepted, urgency: 'assertive' });
      return;
    }
    setConfirming(true);
  }

  async function send() {
    setSending(true);
    let result;
    try {
      result = await respondToMyNotice({
        data: {
          actionId: notice.actionId,
          idempotencyKey,
          text: text.trim(),
          attachments: form.files.flatMap((file) => (file.uploadId ? [file.uploadId] : [])),
        },
      });
    } catch {
      result = { status: 'unavailable' } as const;
    }
    setSending(false);
    setConfirming(false);
    switch (result.status) {
      case 'responded':
        onResponded(result.notice);
        toast({ title: COPY.sent });
        return;
      case 'conflict':
        if (
          result.reason === 'attachment-not-clean' ||
          result.reason === 'attachment-not-accepted'
        ) {
          toast({ title: COPY.attachmentNotClean, urgency: 'assertive' });
        } else {
          toast({
            title: result.reason === 'notice-closed' ? COPY.closedNow : COPY.alreadyResponded,
          });
          void router.invalidate();
        }
        return;
      case 'unauthenticated':
        setError('signed-out');
        return;
      default:
        setError('network');
    }
  }

  const [lead, strong, tail] = COPY.respondInfo(shortName(notice), notice.whatToDo);
  return (
    <Card className="p-0 sm:p-0">
      <h2 className="border-b px-5 py-4 text-base font-semibold">
        {COPY.respond} <span className="font-normal text-muted-foreground">{COPY.optional}</span>
      </h2>
      <div className="grid gap-4 px-5 py-5">
        <Alert role="note">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>
            {lead}
            <strong>{strong}</strong>
            {tail}
          </AlertDescription>
        </Alert>
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={textId}>{COPY.yourResponse}</Label>
            <span
              className={
                tooLong ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'
              }
            >
              {COPY.counter(text.length)}
            </span>
          </div>
          <Textarea
            ref={textRef}
            id={textId}
            rows={5}
            value={text}
            placeholder={COPY.placeholder}
            aria-invalid={missing || tooLong ? true : undefined}
            aria-describedby={missing || tooLong ? errorId : undefined}
            onChange={(event) => {
              dispatch({ type: 'typed', index: 0, text: event.target.value });
            }}
          />
          {missing || tooLong ? (
            <FieldError id={errorId}>{tooLong ? COPY.tooLong : COPY.missing}</FieldError>
          ) : null}
        </div>
        <AttachmentList
          label={COPY.documents}
          attachments={rows}
          accept={ATTACHMENT_ACCEPT}
          maxSize={ATTACHMENT_MAX_BYTES}
          addLabel={COPY.attach}
          addHint={full ? COPY.attachLimit : COPY.attachHint}
          messages={{ removeBody: COPY.removeBody }}
          {...(full ? {} : { onAdd: state.attach })}
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
      <div className="flex flex-wrap items-center gap-3 border-t px-5 py-4">
        <Button className="ml-auto" disabled={checking} onClick={submit}>
          {checking ? <Spinner /> : <Icon icon={SentIcon} />}
          {checking ? COPY.checkingFiles : COPY.submit}
        </Button>
        {error ? (
          <p role="alert" className="flex basis-full items-start gap-2 text-sm text-destructive">
            <Icon icon={WifiOff01Icon} className="mt-0.5 size-4 shrink-0" />
            <span>
              {error === 'network' ? COPY.networkError : COPY.signedOut}{' '}
              {error === 'signed-out' ? (
                <a
                  className="font-medium underline"
                  href={loginHref(`/notices/${notice.actionId}`)}
                >
                  {COPY.signIn}
                </a>
              ) : null}
            </span>
          </p>
        ) : null}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent busy={sending}>
          <DialogHeader>
            <DialogTitle>{COPY.confirmTitle}</DialogTitle>
            <DialogDescription>{COPY.confirmBody}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="warning" role="note">
              <Icon icon={InformationCircleIcon} />
              <AlertDescription>
                {COPY.confirmWarning(notice.step, notice.whatToDo)}
              </AlertDescription>
            </Alert>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{COPY.cancel}</Button>
            </DialogClose>
            <Button disabled={sending} onClick={() => void send()}>
              {sending ? <Spinner /> : null}
              {sending ? COPY.sending : COPY.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ResponseCard({ response }: { response: NonNullable<DeclarantNotice['response']> }) {
  return (
    <Card className="p-0 sm:p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-base font-semibold">{COPY.yourResponse}</h2>
        <span className="text-sm text-muted-foreground">
          {formatDateTime(response.submittedAt)}
        </span>
      </div>
      <div className="grid gap-3 px-5 py-5">
        <p className="rounded-lg border px-4 py-3 whitespace-pre-line">{response.text}</p>
        {response.attachments.length > 0 ? (
          <ul className="grid gap-2" aria-label={COPY.documents}>
            {response.attachments.map((file) => (
              <li
                key={file.uploadId}
                className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
              >
                <Icon icon={File02Icon} className="size-4 text-muted-foreground" />
                {file.fileName}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function SideCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-3">
      {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
      {children}
    </Card>
  );
}

function WindowCard({ notice, now }: { notice: DeclarantNotice; now: string }) {
  const window = windowOf(notice, now);
  if (!window || !notice.actBy || isClosed(notice)) return null;
  const tone =
    window.daysLeft <= 3
      ? 'text-destructive'
      : window.daysLeft <= 7
        ? 'text-warning'
        : 'text-foreground';
  return (
    <SideCard>
      <div className="grid gap-0.5">
        <p className={`text-[22px] font-semibold tracking-tight ${tone}`}>
          {COPY.windowLeft(window.daysLeft)}
        </p>
        <p className="text-sm text-muted-foreground">
          {COPY.windowLine(formatDate(notice.actBy), window.day, window.of)}
        </p>
      </div>
      <ProgressBar
        label={COPY.actBy(formatDate(notice.actBy))}
        value={window.day}
        max={window.of}
        valueText={`${String(window.day)} of ${String(window.of)} days used`}
        size="sm"
        showValue={false}
        tone={window.daysLeft <= 3 ? 'destructive' : 'default'}
        className="[&>div:first-child]:sr-only"
      />
      <div className="flex justify-between text-[12.5px] text-muted-foreground">
        <span>{formatDate(notice.issuedAt)}</span>
        <span>{formatDate(notice.actBy)}</span>
      </div>
    </SideCard>
  );
}

function LetterCard({ notice }: { notice: DeclarantNotice }) {
  return (
    <SideCard title={COPY.letter}>
      <p className="text-sm text-muted-foreground">{COPY.letterRestricted}</p>
      {notice.letterDownloadUrl ? (
        <Button asChild variant="secondary" size="sm" className="justify-self-start">
          <a href={notice.letterDownloadUrl}>
            <Icon icon={Download01Icon} />
            {COPY.downloadLetter}
          </a>
        </Button>
      ) : (
        <p className="text-sm">{COPY.letterNotReady}</p>
      )}
    </SideCard>
  );
}

function HistoryCard({
  notice,
  all,
}: {
  notice: DeclarantNotice;
  all: readonly DeclarantNotice[];
}) {
  const events = ladderNotices(notice, all).flatMap((each) => [
    {
      key: `${each.actionId}:issued`,
      at: each.issuedAt,
      title: COPY.historyIssued(each.step),
      detail: each.reference,
    },
    ...(each.response
      ? [
          {
            key: `${each.actionId}:responded`,
            at: each.response.submittedAt,
            title: COPY.historyResponded,
            detail: null,
          },
        ]
      : []),
  ]);
  events.sort((a, b) => a.at.localeCompare(b.at));
  return (
    <SideCard title={COPY.history}>
      <LadderStrip steps={ladderOf(notice, all)} compact />
      <ol className="mt-1 grid gap-3">
        {events.map((event) => (
          <li key={event.key} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5 text-sm">
            <span aria-hidden="true" className="mt-1.5 size-2 rounded-full bg-border" />
            <div>
              <p className="font-medium">{event.title}</p>
              <p className="text-[12.5px] text-muted-foreground">{formatDate(event.at)}</p>
              {event.detail ? (
                <p className="font-mono text-[12px] text-muted-foreground">{event.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </SideCard>
  );
}
