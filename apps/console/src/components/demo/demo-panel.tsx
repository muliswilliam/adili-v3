import {
  Download01Icon,
  SecurityCheckIcon,
  SlidersHorizontalIcon,
} from '@hugeicons/core-free-icons';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  CopyButton,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  formatTime,
  Icon,
  Spinner,
  Switch,
} from '@adili/ui';
import { useContext, useEffect, useState } from 'react';

import {
  type DemoInbox,
  type DemoPanelState,
  type DemoVerifyCodes,
  getDemoInbox,
  getDemoPanel,
  getDemoVerifyCodes,
  resetDemo,
  setDemoRegistryPaused,
} from '../../server/demo/panel';
import { DEMO_FILES, demoFileHref } from '../../server/demo/files';
import {
  demoVerifyFileHref,
  VERIFY_STATUS_LABELS,
  type VerifyStatus,
} from '../../server/demo/verify';
import { DemoContext } from './demo-context';

/** How long the panel waits for the console to go down after asking for a reset. */
const GOING_DOWN_MS = 45_000;
const POLL_MS = 3000;
/** How often the open panel reads the inboxes again. */
const INBOX_POLL_MS = 4000;

/**
 * The demo panel (#621) beside the role switcher in the console's top bar: reset the stack to a
 * checkpoint, download the files the beats upload, open a document in every verify status, pause
 * and resume each registry mock, read the demo inboxes. Demo mode and a signed-in demo account only; nothing renders otherwise.
 */
export function DemoPanel() {
  const demo = useContext(DemoContext);
  const [open, setOpen] = useState(false);
  if (!demo?.current) return null;
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="sm">
          <Icon icon={SlidersHorizontalIcon} />
          <span className="max-[900px]:sr-only">Demo panel</span>
        </Button>
      </DrawerTrigger>
      {open ? <DemoPanelContent /> : null}
    </Drawer>
  );
}

function DemoPanelContent() {
  const [panel, setPanel] = useState<DemoPanelState | null | 'loading'>('loading');
  const [resetting, setResetting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getDemoPanel().then((state) => {
      if (live) setPanel(state);
    });
    return () => {
      live = false;
    };
  }, []);

  async function reset(checkpoint: string) {
    setError(null);
    setResetting(checkpoint);
    const result = await resetDemo({ data: { checkpoint } });
    if (!result?.ok) {
      setResetting(null);
      setError(result?.message ?? 'Only a signed-in demo account can reset the demo.');
      return;
    }
    await waitForRestart();
    window.location.assign('/');
  }

  async function toggle(system: string, paused: boolean) {
    if (panel === 'loading' || !panel) return;
    const state = await setDemoRegistryPaused({
      data: { system: system as 'kra', paused },
    });
    setPanel({
      ...panel,
      registries: panel.registries.map((registry) =>
        registry.system === system ? { ...registry, paused: state } : registry,
      ),
    });
  }

  return (
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Demo panel</DrawerTitle>
        <DrawerDescription>
          Put the demo back to a checkpoint, download the files the beats upload, open a document in
          every verify status, take a registry offline to show how filing and review carry on
          without it, or read the codes the platform just sent.
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody>
        {panel === 'loading' ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading
          </p>
        ) : panel === null ? (
          <p className="text-sm text-muted-foreground">
            Sign in with a demo account to use the demo panel.
          </p>
        ) : resetting ? (
          <Alert variant="info" role="status">
            <AlertTitle>Resetting the demo to {resetting}</AlertTitle>
            <AlertDescription>
              Every app restarts on the restored stack, this console too. It is back in about two
              minutes and this page reloads by itself; then pick an account to act as.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <section aria-labelledby="demo-checkpoints" className="flex flex-col gap-2.5">
              <h3 id="demo-checkpoints" className="text-sm font-semibold">
                Reset to a checkpoint
              </h3>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {panel.reset === 'command' ? (
                <p className="text-sm text-muted-foreground">
                  On a local stack, stop <code>pnpm dev</code>, run the reset, then start{' '}
                  <code>pnpm dev</code> again.
                </p>
              ) : null}
              <ul className="flex flex-col divide-y rounded-lg border">
                {panel.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.name} className="flex items-start gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[13px] font-medium">{checkpoint.name}</p>
                      <p className="text-sm">{checkpoint.state}</p>
                      <p className="text-xs text-muted-foreground">Starts: {checkpoint.beat}</p>
                      {panel.reset === 'command' ? (
                        <p className="mt-1.5 font-mono text-xs">
                          pnpm demo:reset {checkpoint.name}
                        </p>
                      ) : null}
                    </div>
                    {panel.reset === 'command' ? (
                      <CopyButton
                        value={`pnpm demo:reset ${checkpoint.name}`}
                        label={`Copy pnpm demo:reset ${checkpoint.name}`}
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                      />
                    ) : confirming === checkpoint.name ? (
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setConfirming(null);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void reset(checkpoint.name)}
                        >
                          Reset now
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                        onClick={() => {
                          setConfirming(checkpoint.name);
                        }}
                      >
                        Reset
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <DemoFilesSection />
            <DemoVerifySection />
            <section aria-labelledby="demo-registries" className="flex flex-col gap-2.5">
              <h3 id="demo-registries" className="text-sm font-semibold">
                Registries
              </h3>
              <p className="text-sm text-muted-foreground">
                A paused registry answers as unavailable, cached answers included: filing and review
                carry on and show it as not available. Integrations shows it paused by Juma Omondi.
              </p>
              <ul className="flex flex-col divide-y rounded-lg border">
                {panel.registries.map((registry) => (
                  <li
                    key={registry.system}
                    className="flex items-center justify-between gap-3 px-3.5 py-2"
                  >
                    <Switch
                      label={registry.label}
                      checked={registry.paused === false}
                      blockedReason={
                        registry.paused === null ? 'The integration mocks did not answer' : ''
                      }
                      onCheckedChange={(online) => void toggle(registry.system, !online)}
                    />
                    <span className="text-sm text-muted-foreground">
                      {registry.paused === null
                        ? 'Unreachable'
                        : registry.paused
                          ? 'Paused'
                          : 'Online'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <DemoInboxSection />
          </>
        )}
      </DrawerBody>
    </DrawerContent>
  );
}

/**
 * The files the live beats upload, served by the stack itself so they match what it was seeded
 * from (#679).
 */
function DemoFilesSection() {
  return (
    <section aria-labelledby="demo-files" className="flex flex-col gap-2.5">
      <h3 id="demo-files" className="text-sm font-semibold">
        Demo files
      </h3>
      <p className="text-sm text-muted-foreground">
        The files the live beats upload, as this stack holds them. Download them here rather than
        from a copy of the repository, which can be out of date.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border" aria-label="Demo files">
        {DEMO_FILES.map((file) => (
          <li key={file.name} className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.label}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">Used in: {file.beat}</p>
            </div>
            <Button asChild size="sm" variant="secondary" className="shrink-0">
              <a
                href={demoFileHref(file)}
                download={file.name}
                aria-label={`Download ${file.name}`}
              >
                <Icon icon={Download01Icon} />
                Download
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const VERIFY_TONES: Record<VerifyStatus, 'success' | 'warning' | 'destructive' | 'default'> = {
  valid: 'success',
  superseded: 'warning',
  revoked: 'destructive',
  expired: 'default',
  'hash-mismatch': 'destructive',
};

/**
 * A document in every verify status (beat I), as `pnpm demo:seed --only verify` wrote them on this
 * stack: the codes change with every seed from empty, and the hosted presenter cannot read the
 * host's `.demo/verify.md`.
 */
function DemoVerifySection() {
  const [codes, setCodes] = useState<DemoVerifyCodes | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    void getDemoVerifyCodes().then((state) => {
      if (live) setCodes(state);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="demo-verify" className="flex flex-col gap-2.5">
      <h3 id="demo-verify" className="text-sm font-semibold">
        Verify codes
      </h3>
      <p className="text-sm text-muted-foreground">
        A document in every status the verify app shows, as this stack was seeded. Open one, or
        paste its code on the verify page.
      </p>
      {codes === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading
        </p>
      ) : codes === null ? null : codes.state === 'not-seeded' ? (
        <p className="text-sm text-muted-foreground">
          No codes on this stack yet: run <code>pnpm demo:seed --only verify</code>.
        </p>
      ) : codes.state === 'unreadable' ? (
        <p className="text-sm text-muted-foreground">
          The seed&apos;s verify codes could not be read: run{' '}
          <code>pnpm demo:seed --only verify</code> again.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-label="Verify codes">
          {codes.documents.map((document) => {
            const label = VERIFY_STATUS_LABELS[document.status];
            return (
              <li
                key={`${document.status}-${document.verificationId}`}
                className="flex flex-col gap-2 px-3.5 py-2.5"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Badge variant={VERIFY_TONES[document.status]}>{label}</Badge>
                    <p className="mt-1 text-sm">{document.what}</p>
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      {document.verificationId}
                    </p>
                  </div>
                  <CopyButton
                    value={document.verificationId}
                    label={`Copy the ${label.toLowerCase()} code`}
                    size="sm"
                    className="shrink-0"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="xs" variant="secondary">
                    <a
                      href={document.verifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open the ${label.toLowerCase()} document's verify page`}
                    >
                      <Icon icon={SecurityCheckIcon} />
                      Open verify page
                    </a>
                  </Button>
                  {document.file ? (
                    <Button asChild size="xs" variant="secondary">
                      <a
                        href={demoVerifyFileHref(document.file)}
                        download={document.file}
                        aria-label={`Download ${document.file}`}
                      >
                        <Icon icon={Download01Icon} />
                        Download tampered PDF
                      </a>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The codes the stack just sent by text message and email, newest first and read again every few
 * seconds while the panel is open: onboarding an officer live on the hosted demo, where neither
 * inbox is published (#371).
 */
function DemoInboxSection() {
  const [inbox, setInbox] = useState<DemoInbox | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    const read = () =>
      void getDemoInbox().then((state) => {
        if (live) setInbox(state);
      });
    read();
    const timer = setInterval(read, INBOX_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section aria-labelledby="demo-inbox" className="flex flex-col gap-2.5">
      <h3 id="demo-inbox" className="text-sm font-semibold">
        Demo inbox
      </h3>
      <p className="text-sm text-muted-foreground">
        The sign-in and onboarding codes the platform just sent, so an officer can onboard live.
      </p>
      {inbox === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading
        </p>
      ) : inbox === null ? null : (
        <>
          <InboxList
            title="Text messages"
            unreachable="The SMS mock did not answer."
            messages={inbox.sms?.map((sms) => ({
              id: sms.id,
              to: sms.to,
              heading: null,
              text: sms.text,
              code: sms.code,
              receivedAt: sms.receivedAt,
            }))}
          />
          <InboxList
            title="Emails"
            unreachable="Mailpit did not answer."
            messages={inbox.email?.map((email) => ({
              id: email.id,
              to: email.to,
              heading: email.subject,
              text: email.text,
              code: email.code,
              receivedAt: email.receivedAt,
            }))}
          />
        </>
      )}
    </section>
  );
}

interface InboxMessage {
  id: string;
  to: string;
  heading: string | null;
  text: string;
  code: string | null;
  receivedAt: string;
}

function InboxList({
  title,
  unreachable,
  messages,
}: {
  title: string;
  unreachable: string;
  /** undefined when the inbox did not answer. */
  messages: InboxMessage[] | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {messages === undefined ? (
        <p className="text-sm text-muted-foreground">{unreachable}</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" aria-label={title}>
          {messages.map((message) => (
            <li key={message.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">To {message.to}</span>
                  <time dateTime={message.receivedAt} className="shrink-0 tabular-nums">
                    {formatTime(message.receivedAt)}
                  </time>
                </p>
                {message.heading ? (
                  <p className="truncate text-sm font-medium">{message.heading}</p>
                ) : null}
                <p className="line-clamp-2 text-sm text-muted-foreground">{message.text}</p>
              </div>
              {message.code ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="font-mono text-base font-semibold tracking-widest tabular-nums">
                    {message.code}
                  </span>
                  <CopyButton value={message.code} label={`Copy code ${message.code}`} size="sm" />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Waits for the console to go down for the restart (or for a while, if it went faster than a
 * poll), then for it to answer again.
 */
async function waitForRestart(): Promise<void> {
  const answers = async () => {
    try {
      await fetch('/', { redirect: 'manual', cache: 'no-store' });
      return true;
    } catch {
      return false;
    }
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const asked = Date.now();
  while (Date.now() - asked < GOING_DOWN_MS && (await answers())) await sleep(POLL_MS);
  while (!(await answers())) await sleep(POLL_MS);
}
