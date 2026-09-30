import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CopyButton,
  DescriptionItem,
  DescriptionList,
  formatDate,
  formatDateTime,
  Icon,
  LogoWordmark,
  MaskedContact,
  obligationTypeLabel,
  QrCode,
  Spinner,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Clock01Icon,
  Download01Icon,
  LinkSquare02Icon,
  RefreshIcon,
  SecurityCheckIcon,
  SentIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { Fragment, useEffect, useReducer, useRef, useState } from 'react';

import type { Declaration, DeclarationVersion } from '../../server/declarations/types';
import {
  getMyAcknowledgement,
  getMySlipDownload,
  reissueMyAcknowledgement,
  type SlipContext,
} from '../../server/submission';
import { downloadFrom } from '../download';
import {
  cooldownLeft,
  initialSlipState,
  sentTo,
  SLIP_COPY,
  SLIP_POLL_INTERVAL_MS,
  slipAnnouncement,
  slipReducer,
  type SlipState,
} from './slip';

export interface SlipCardProps {
  declaration: Declaration;
  version: DeclarationVersion;
  context: Pick<SlipContext, 'declarant'>;
}

/**
 * The acknowledgement slip of a submitted version on the success page (spec 06 FE-3): while it
 * is prepared the card polls `getAcknowledgement` every two seconds for a minute, then says it is
 * taking longer with "Check again"; once issued it shows the slip's details, verification code
 * and QR (the acknowledgement's `verifyUrl`) with a download link fetched fresh on click; a failed slip can be asked for again after a
 * cooldown. A screen reader hears each change of state once, not each poll.
 */
export function SlipCard({ declaration, version, context }: SlipCardProps) {
  const [state, dispatch] = useReducer(slipReducer, version.acknowledgement, initialSlipState);
  const announcement = useAnnouncement(state);

  const { id: declarationId } = declaration;
  const { version: number } = version;
  useEffect(() => {
    // Each read makes a new state, which schedules the next one.
    if (state.step !== 'preparing') return;
    let stopped = false;
    const timer = setTimeout(() => {
      void getMyAcknowledgement({ data: { declarationId, version: number } })
        .catch(() => null)
        .then((answer) => {
          if (stopped) return;
          dispatch({
            type: 'read',
            acknowledgement: answer?.status === 'ok' ? answer.acknowledgement : null,
          });
        });
    }, SLIP_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [state, declarationId, number]);

  function reissue() {
    dispatch({ type: 'reissue-pressed', now: Date.now() });
    void reissueMyAcknowledgement({ data: { declarationId, version: number } })
      .catch(() => ({ status: 'unavailable' as const }))
      .then((answer) => {
        dispatch({ type: 'reissue-answered', answer, now: Date.now() });
      });
  }

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {state.step === 'preparing' ? (
        <Card className="p-0 sm:p-0">
          <div className="flex items-center gap-3.5 px-5 py-[22px]">
            <Spinner className="text-foreground" />
            <div className="grid gap-0.5">
              <p className="font-semibold">{SLIP_COPY.preparing}</p>
              <p className="text-sm text-muted-foreground">{SLIP_COPY.preparingHint}</p>
            </div>
          </div>
        </Card>
      ) : state.step === 'slow' ? (
        <Card className="p-0 sm:p-0">
          <div className="flex flex-wrap items-center gap-3.5 px-5 py-[22px]">
            <Icon icon={Clock01Icon} className="size-[22px] text-warning" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="font-semibold">{SLIP_COPY.slow}</p>
              <p className="text-sm text-muted-foreground">{SLIP_COPY.slowHint}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                dispatch({ type: 'check-again' });
              }}
            >
              <Icon icon={RefreshIcon} />
              {SLIP_COPY.checkAgain}
            </Button>
          </div>
        </Card>
      ) : state.step === 'failed' ? (
        <FailedSlip key={state.cooldownUntil ?? 'none'} state={state} onReissue={reissue} />
      ) : (
        <IssuedSlip
          declaration={declaration}
          version={version}
          context={context}
          state={state}
          onRead={(acknowledgement) => {
            dispatch({ type: 'read', acknowledgement });
          }}
        />
      )}
    </>
  );
}

/** The live region's text: empty on load, then what the slip changed to. */
function useAnnouncement(state: SlipState): string {
  const [announcement, setAnnouncement] = useState('');
  const text = slipAnnouncement(state);
  const previous = useRef(text);
  useEffect(() => {
    if (previous.current === text) return;
    previous.current = text;
    setAnnouncement(text);
  }, [text]);
  return announcement;
}

/**
 * Seconds left of the failed slip's cooldown, ticking every second while there are some. The
 * view remounts it for each new cooldown, so it starts from a fresh clock.
 */
function useCooldown(state: Extract<SlipState, { step: 'failed' }>): number {
  const [now, setNow] = useState(() => Date.now());
  const left = cooldownLeft(state, now);
  useEffect(() => {
    if (left === 0) return;
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [left, now]);
  return left;
}

function FailedSlip({
  state,
  onReissue,
}: {
  state: Extract<SlipState, { step: 'failed' }>;
  onReissue: () => void;
}) {
  const left = useCooldown(state);
  return (
    // The live region above announces the change; the alert role would announce it again.
    <Alert variant="destructive" role={undefined}>
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{SLIP_COPY.failed}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2.5">
        <p>{state.problem === 'error' ? SLIP_COPY.reissueError : SLIP_COPY.failedHint}</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={state.requesting || left > 0}
          onClick={onReissue}
        >
          {state.requesting ? (
            <>
              <Spinner />
              {SLIP_COPY.requesting}
            </>
          ) : left > 0 ? (
            SLIP_COPY.requestAgainIn(left)
          ) : (
            <>
              <Icon icon={RefreshIcon} />
              {SLIP_COPY.requestAgain}
            </>
          )}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function IssuedSlip({
  declaration,
  version,
  context,
  state,
  onRead,
}: SlipCardProps & {
  state: Extract<SlipState, { step: 'issued' }>;
  onRead: (acknowledgement: DeclarationVersion['acknowledgement']) => void;
}) {
  const { acknowledgement } = state;
  const code = acknowledgement.verificationId ?? '';
  const link = acknowledgement.verifyUrl ?? '';
  const delivered = context.declarant
    ? sentTo(context.declarant.maskedEmail, context.declarant.maskedPhone)
    : [];
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  async function download() {
    const { documentId } = acknowledgement;
    if (documentId === null) return;
    setDownloading(true);
    // The link comes from the documents service; the acknowledgement, read alongside, brings a
    // fresh verified count.
    const [link, answer] = await Promise.all([
      getMySlipDownload({ data: { documentId } }).catch(() => null),
      getMyAcknowledgement({
        data: { declarationId: declaration.id, version: version.version },
      }).catch(() => null),
    ]);
    setDownloading(false);
    if (answer?.status === 'ok' && answer.acknowledgement.status === 'issued') {
      onRead(answer.acknowledgement);
    }
    if (link?.status === 'ok') {
      downloadFrom(link.downloadUrl);
    } else {
      toast({ title: SLIP_COPY.downloadFailed, urgency: 'assertive' });
    }
  }

  return (
    <section
      aria-labelledby="slip-heading"
      className="overflow-hidden rounded-2xl bg-card text-card-foreground shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-dashed border-brand/30 bg-[repeating-linear-gradient(135deg,var(--brand-faint)_0_10px,var(--brand-subtle)_10px_20px)] px-5 py-[18px]">
        <LogoWordmark className="h-5" />
        <h2 id="slip-heading" className="ml-1 text-sm font-semibold">
          {SLIP_COPY.issued}
        </h2>
        <Badge variant="success" className="ml-auto">
          <Icon icon={SecurityCheckIcon} />
          {SLIP_COPY.signed}
        </Badge>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-6">
        <DescriptionList className="min-w-0 [&>div:first-child]:pt-[11px] [&>div:last-child]:pb-[11px]">
          <DescriptionItem term={SLIP_COPY.reference} className="items-center">
            <span className="font-mono text-sm">{version.reference}</span>
          </DescriptionItem>
          {context.declarant ? (
            <DescriptionItem term={SLIP_COPY.declarant}>
              {context.declarant.fullName}
            </DescriptionItem>
          ) : null}
          <DescriptionItem term={SLIP_COPY.commission}>
            {declaration.commission.name}
          </DescriptionItem>
          <DescriptionItem term={SLIP_COPY.type}>
            {obligationTypeLabel(declaration.type, declaration.statementDate)}
          </DescriptionItem>
          <DescriptionItem term={SLIP_COPY.statementDate}>
            {formatDate(declaration.statementDate)}
          </DescriptionItem>
          <DescriptionItem term={SLIP_COPY.version}>{version.version}</DescriptionItem>
          <DescriptionItem term={SLIP_COPY.submitted}>
            {formatDateTime(version.submittedAt)}
            {version.late ? ` · ${SLIP_COPY.late}` : ''}
          </DescriptionItem>
        </DescriptionList>
        <div className="grid justify-items-center">
          <QrCode value={link} label={SLIP_COPY.qrLabel(code)} size={124} />
          <p className="mt-1 text-[11.5px] text-muted-foreground">{SLIP_COPY.scanHint}</p>
        </div>
      </div>
      <div className="grid gap-2.5 px-5 pb-4">
        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">
            {SLIP_COPY.verificationCode}
          </p>
          <div className="flex items-center gap-1.5 rounded-lg bg-muted py-2 pr-2 pl-3">
            <span className="flex-1 font-mono text-sm font-semibold tracking-[0.03em] break-words">
              {code}
            </span>
            <CopyButton
              value={code}
              label={SLIP_COPY.copyCode}
              copiedMessage={SLIP_COPY.codeCopied}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {delivered.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={SentIcon} className="size-3.5" />
              <span>
                {SLIP_COPY.sentTo}
                {delivered.map((contact, index) => (
                  <Fragment key={contact.kind}>
                    {index > 0 ? ` ${SLIP_COPY.and}` : null}{' '}
                    <MaskedContact kind={contact.kind} value={contact.value} />
                  </Fragment>
                ))}
              </span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={ViewIcon} className="size-3.5" />
            {SLIP_COPY.verified(acknowledgement.verifiedCount)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3.5 sm:px-6">
        <Button size="sm" disabled={downloading} onClick={() => void download()}>
          {downloading ? <Spinner /> : <Icon icon={Download01Icon} />}
          {SLIP_COPY.download}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={link} target="_blank" rel="noopener noreferrer">
            <Icon icon={LinkSquare02Icon} />
            {SLIP_COPY.verifyOnline}
          </a>
        </Button>
      </div>
    </section>
  );
}
