import {
  Button,
  countdownAnnouncement,
  formatClock,
  Icon,
  MaskedContact,
  OtpInput,
  secondsUntil,
  Spinner,
  useCountdown,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Clock01Icon,
  RefreshIcon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { useEffect, useRef, useState } from 'react';

import { type OtpAction, OTP_ACTIONS, OTP_FIELDS, type OtpChannel } from '../adili-otp';
import { Callout, PageAlert } from '../components/PageAlert';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import type { MessageKey } from '../shared';
import Template from '../Template';

export type AdiliOtpKcContext = Extract<KcContext, { pageId: 'login-adili-otp.ftl' }>;
type AdiliOtpProps = PageProps<AdiliOtpKcContext, I18n>;

/** The number of new codes a sign-in starts with; "codes left" shows once one is used. */
const MAX_RESENDS = 3;

interface ChannelCopy {
  other: OtpChannel;
  contactKind: 'phone' | 'email';
  /** The action that sends a code on this channel. */
  send: OtpAction;
  sentTo: MessageKey;
  switchTo: MessageKey;
  instead: MessageKey;
  sendBy: MessageKey;
  retry: MessageKey;
  failedTitle: MessageKey;
}

/** Everything that differs by channel: the other channel, the action and the copy. */
const CHANNELS = {
  sms: {
    other: 'email',
    contactKind: 'phone',
    send: OTP_ACTIONS.sendSms,
    sentTo: 'adiliOtpSentBySms',
    switchTo: 'adiliOtpSwitchToSms',
    instead: 'adiliOtpSmsInstead',
    sendBy: 'adiliOtpSendBySms',
    retry: 'adiliOtpRetrySms',
    failedTitle: 'adiliOtpSmsFailedTitle',
  },
  email: {
    other: 'sms',
    contactKind: 'email',
    send: OTP_ACTIONS.sendEmail,
    sentTo: 'adiliOtpSentByEmail',
    switchTo: 'adiliOtpSwitchToEmail',
    instead: 'adiliOtpEmailInstead',
    sendBy: 'adiliOtpSendByEmail',
    retry: 'adiliOtpRetryEmail',
    failedTitle: 'adiliOtpEmailFailedTitle',
  },
} as const satisfies Record<OtpChannel, ChannelCopy>;

/**
 * The declarant's second factor (login-adili-otp.ftl, rendered by the `adili-otp`
 * authenticator): a 6-digit code sent by SMS or email, with resend, switch channel and the
 * authenticator's error states. See ../adili-otp.ts for the fields it posts.
 */
export default function AdiliOtp(props: AdiliOtpProps) {
  return props.kcContext.sendFailed ? <SendFailed {...props} /> : <CodeEntry {...props} />;
}

function CodeEntry({ kcContext, i18n, doUseDefaultCss, classes }: AdiliOtpProps) {
  const {
    url,
    channel,
    maskedDestination,
    alternativeDestination,
    attemptsLeft,
    resendsLeft,
    resendAvailableAt,
    otpError,
    isStepUp,
  } = kcContext;
  const { msg, msgStr } = i18n;
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const other = CHANNELS[channel].other;

  // Submit once the sixth digit has rendered into the hidden `otp` field; there is no button.
  useEffect(() => {
    if (checking) form.current?.requestSubmit();
  }, [checking]);

  const error =
    otpError === 'invalid'
      ? attemptsLeft === 1
        ? msgStr('adiliOtpInvalidOne')
        : msgStr('adiliOtpInvalid', String(attemptsLeft))
      : otpError === 'expired'
        ? msgStr('adiliOtpExpired')
        : null;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      headerNode={msg(isStepUp ? 'adiliOtpStepUpTitle' : 'adiliOtpTitle')}
      subtitleNode={
        <>
          {msg(CHANNELS[channel].sentTo)}{' '}
          <MaskedContact
            kind={CHANNELS[channel].contactKind}
            value={maskedDestination}
            privacyHint={msgStr('adiliPartiallyHidden')}
            className="text-foreground"
          />
          .
        </>
      }
    >
      {error ? (
        <PageAlert
          variant={otpError === 'expired' ? 'warning' : 'destructive'}
          icon={otpError === 'expired' ? Clock01Icon : AlertCircleIcon}
        >
          {error}
        </PageAlert>
      ) : null}

      <form
        ref={form}
        id="kc-otp-login-form"
        action={url.loginAction}
        method="post"
        className="grid gap-2.5"
      >
        <input type="hidden" name={OTP_FIELDS.action} value={OTP_ACTIONS.verify} />
        <OtpInput
          label={msgStr('adiliOtpCodeLabel')}
          name={OTP_FIELDS.code}
          value={code}
          onChange={setCode}
          onComplete={() => {
            setChecking(true);
          }}
          // A failure puts focus on its alert instead.
          autoFocus={!error}
          disabled={checking}
        />
        {/* Always mounted, so screen readers announce the busy state when it appears. */}
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-[13.5px] text-muted-foreground"
        >
          {checking ? (
            <>
              <Spinner className="size-3.5 text-foreground" />
              {msg('adiliOtpChecking')}
            </>
          ) : (
            <>
              <Icon icon={Clock01Icon} className="size-3.5" />
              {msg('adiliOtpValidFor')}
            </>
          )}
        </p>
      </form>

      <form action={url.loginAction} method="post" className="grid gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ResendButton i18n={i18n} resendAvailableAt={resendAvailableAt} disabled={checking} />
          {alternativeDestination ? (
            <Button
              type="submit"
              variant="link"
              name={OTP_FIELDS.action}
              value={CHANNELS[other].send}
              disabled={checking}
            >
              {msg(CHANNELS[other].switchTo)}
            </Button>
          ) : null}
        </div>
        {resendsLeft < MAX_RESENDS ? (
          <p className="text-[13.5px] text-muted-foreground">
            {resendsLeft <= 0
              ? msg('adiliOtpResendsNone')
              : resendsLeft === 1
                ? msg('adiliOtpResendsLeftOne')
                : msg('adiliOtpResendsLeft', String(resendsLeft))}
          </p>
        ) : null}
      </form>
    </Template>
  );
}

/**
 * "Resend code", disabled with a countdown until the authenticator's cooldown ends. The wait
 * ticks every second on screen, but screen readers hear it only at 10-second steps.
 */
function ResendButton({
  i18n,
  resendAvailableAt,
  disabled,
}: {
  i18n: I18n;
  resendAvailableAt: string | undefined;
  disabled: boolean;
}) {
  const { msg, msgStr } = i18n;
  const [secondsLeft] = useCountdown(secondsUntil(resendAvailableAt));
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(secondsLeft);

  useEffect(() => {
    const message = countdownAnnouncement(previous.current, secondsLeft, (seconds) =>
      seconds === 0 ? msgStr('adiliOtpResendReady') : msgStr('adiliOtpResendWait', String(seconds)),
    );
    previous.current = secondsLeft;
    if (message) setAnnouncement(message);
  }, [secondsLeft, msgStr]);

  const waiting = secondsLeft > 0;
  return (
    <span className="text-muted-foreground">
      {msg('adiliOtpDidNotGetIt')}{' '}
      <Button
        type="submit"
        variant="link"
        name={OTP_FIELDS.action}
        value={OTP_ACTIONS.resend}
        disabled={waiting || disabled}
        className="tabular-nums disabled:text-muted-foreground disabled:no-underline disabled:opacity-100"
      >
        {waiting ? msg('adiliOtpResendIn', formatClock(secondsLeft)) : msg('adiliOtpResend')}
      </Button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}

/** The code did not go out: offer the other channel, or ask to try later when both failed. */
function SendFailed({ kcContext, i18n, doUseDefaultCss, classes }: AdiliOtpProps) {
  const { url, channel, sendFailed, alternativeDestination } = kcContext;
  const { msg, msgStr } = i18n;
  const both = sendFailed === 'both';
  const failed: OtpChannel = !sendFailed || sendFailed === 'both' ? channel : sendFailed;
  const other = CHANNELS[failed].other;
  const canSwitch = !both && alternativeDestination !== undefined;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      mark={both ? { icon: WifiDisconnected01Icon, tone: 'destructive' } : undefined}
      headerNode={msg(both ? 'adiliOtpBothFailedTitle' : CHANNELS[failed].failedTitle)}
      subtitleNode={msg(
        both
          ? 'adiliOtpBothFailedText'
          : canSwitch
            ? 'adiliOtpSendFailedText'
            : 'adiliOtpSendFailedNoAlternative',
      )}
    >
      <form action={url.loginAction} method="post" className="grid gap-3">
        {canSwitch ? (
          <>
            <Callout>
              {msg(CHANNELS[other].instead)}{' '}
              <MaskedContact
                kind={CHANNELS[other].contactKind}
                value={alternativeDestination}
                privacyHint={msgStr('adiliPartiallyHidden')}
              />
              .
            </Callout>
            <Button
              type="submit"
              name={OTP_FIELDS.action}
              value={CHANNELS[other].send}
              className="w-full"
              autoFocus
            >
              {msg(CHANNELS[other].sendBy)}
            </Button>
            <Button
              type="submit"
              variant="ghost"
              name={OTP_FIELDS.action}
              value={CHANNELS[failed].send}
              className="w-full"
            >
              {msg(CHANNELS[failed].retry)}
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            name={OTP_FIELDS.action}
            value={both ? OTP_ACTIONS.resend : CHANNELS[failed].send}
            className="w-full"
            autoFocus
          >
            <Icon icon={RefreshIcon} />
            {msg('adiliTryAgain')}
          </Button>
        )}
        <Button asChild variant="secondary" className="w-full">
          <a href={url.loginRestartFlowUrl}>{msg('adiliBackToSignIn')}</a>
        </Button>
      </form>
    </Template>
  );
}
