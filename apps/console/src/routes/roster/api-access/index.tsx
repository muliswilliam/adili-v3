import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CopyButton,
  Dialog,
  DialogTrigger,
  EmptyState,
  Icon,
  Skeleton,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  InformationCircleIcon,
  Key01Icon,
  Loading03Icon,
  PlusSignIcon,
  ArrowReloadHorizontalIcon,
  Clock01Icon,
  File01Icon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useBlocker, useRouter } from '@tanstack/react-router';
import { type ReactNode, useRef, useState } from 'react';

import { formatDate, formatDateTime, formatRelativeTime } from '../../../components/format';
import { LoadError, NoAccess } from '../../../components/load-error';
import { DetailItem, DetailList, Page, PageHead, SectionCard } from '../../../components/page';
import {
  type CredentialAction,
  credentialFailure,
  credentialState,
} from '../../../components/roster/api-credential';
import {
  RevokeDialogContent,
  RotateDialogContent,
  SavedDialogContent,
} from '../../../components/roster/credential-dialogs';
import { ROSTER_WRITE_SCOPE } from '../../../components/roster/api-docs';
import { CredentialField } from '../../../components/roster/credential-field';
import { messages as m } from '../../../components/roster/messages';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import type {
  DirectoryError,
  DirectoryResult,
  RosterApiCredential,
  RosterApiCredentialWithSecret,
} from '../../../server/directory/client';
import {
  createRosterApiCredential,
  getRosterApiCredential,
  revokeRosterApiCredential,
  rotateRosterApiCredential,
} from '../../../server/roster-api-credential';

const PAGE_PATH = '/roster/api-access';

export const Route = createFileRoute('/roster/api-access/')({
  loader: async ({ location, context }) => {
    // The layout shows no page without the workspace, and read-only users are told credentials
    // are not theirs (the directory refuses them); fetch nothing for either.
    if (!context.workspace || context.workspace.readOnly) return null;
    if (!context.tenant) return noCommission;
    const result = await getRosterApiCredential({ data: { slug: context.tenant } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.apiTitle} · Adili Online Console` }] }),
  pendingComponent: ApiAccessSkeleton,
  component: ApiAccess,
});

/** A roster-workspace role without a tenant: a broken account, shown as a failed load. */
const noCommission: DirectoryResult<RosterApiCredential | null> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

const isForbidden = (error: DirectoryError) =>
  error.kind === 'problem' && error.problem.status === 403;

function ApiAccess() {
  const result = Route.useLoaderData();
  const { workspace, tenant } = Route.useRouteContext();
  if (!workspace) return null;
  // Credentials are the reporting officer's alone; the directory refuses commission admins.
  if (workspace.readOnly || (result && !result.ok && isForbidden(result.error))) {
    return (
      <Page narrow>
        <PageHead title={m.apiTitle} />
        <NoAccess text={m.apiNoAccess} />
      </Page>
    );
  }
  if (!result) return null;
  if (!result.ok || !tenant) {
    return (
      <Page narrow>
        <PageHead title={m.apiTitle} />
        <LoadError title={m.apiErrorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
      </Page>
    );
  }
  return <Credentials slug={tenant} credential={result.data} />;
}

/** A secret the directory just issued; it lives only in this page's memory. */
interface Issued {
  credential: RosterApiCredentialWithSecret;
  rotated: boolean;
}

const unavailable = { ok: false as const, error: { kind: 'unavailable' as const, detail: null } };

/**
 * The page for the stored credential (none, active, revoked) and, right after create or rotate,
 * the secret shown once. Leaving while the secret is on screen asks whether it was saved.
 */
function Credentials({
  slug,
  credential,
}: {
  slug: string;
  credential: RosterApiCredential | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const titleRef = useRef<HTMLSpanElement>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<'rotate' | 'revoke' | 'done' | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** The control that opened the dialog is gone once it succeeds: focus the title instead. */
  const focusTitleOnClose = useRef(false);

  const blocker = useBlocker({
    shouldBlockFn: () => issued !== null,
    enableBeforeUnload: () => issued !== null,
    withResolver: true,
  });

  const focusTitle = () => {
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const signIn = () => {
    goToSignIn(PAGE_PATH);
  };

  /** Handles a failed action; returns the message to show in its dialog, if it stays open. */
  const failed = (action: CredentialAction, error: DirectoryError): string | null => {
    const failure = credentialFailure(action, error);
    if (failure.kind === 'sign-in') {
      signIn();
      return null;
    }
    if (failure.stale) {
      void router.invalidate();
      toast({ title: failure.message, urgency: 'assertive' });
      return null;
    }
    return failure.message;
  };

  const show = (next: Issued) => {
    setIssued(next);
    // The metadata behind the secret changed; reload it for when the secret is put away.
    void router.invalidate();
    focusTitle();
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    const result = await createRosterApiCredential({ data: { slug } }).catch(() => unavailable);
    setCreating(false);
    if (result.ok) {
      show({ credential: result.data, rotated: false });
      return;
    }
    const message = failed('create', result.error);
    if (message) toast({ title: message, urgency: 'assertive' });
  };

  const runDialogAction = async (
    action: 'rotate' | 'revoke',
    call: () => Promise<DirectoryResult<RosterApiCredentialWithSecret | null>>,
  ) => {
    if (dialogBusy) return;
    setDialogBusy(true);
    setDialogError(null);
    const result = await call().catch(() => unavailable);
    setDialogBusy(false);
    if (result.ok) {
      focusTitleOnClose.current = true;
      setDialog(null);
      if (action === 'rotate' && result.data) {
        show({ credential: result.data, rotated: true });
        toast({ title: m.apiRotatedToast });
      } else {
        void router.invalidate();
        toast({ title: m.apiRevokedToast });
      }
      return;
    }
    const message = failed(action, result.error);
    if (message) {
      setDialogError(message);
    } else {
      setDialog(null);
    }
  };

  /** The secret was saved: put it away, then continue where the officer was going. */
  const saved = () => {
    const rotated = issued?.rotated ?? false;
    setIssued(null);
    setDialog(null);
    if (blocker.status === 'blocked') {
      blocker.proceed();
      return;
    }
    focusTitleOnClose.current = true;
    if (!rotated) toast({ title: m.apiActiveToast });
  };

  const openDialog = (next: typeof dialog) => {
    setDialogError(null);
    setDialog(next);
  };

  const onCloseAutoFocus = (event: Event) => {
    if (focusTitleOnClose.current) {
      focusTitleOnClose.current = false;
      event.preventDefault();
      titleRef.current?.focus();
    }
  };

  const savedOpen = dialog === 'done' || blocker.status === 'blocked';
  const state = credentialState(credential);
  const title = issued ? (issued.rotated ? m.apiRotatedTitle : m.apiCreatedTitle) : m.apiTitle;

  return (
    <Page>
      <PageHead
        title={
          <span ref={titleRef} tabIndex={-1} className="outline-none">
            {title}
          </span>
        }
        actions={issued ? null : <DocsButton />}
      />
      {issued ? (
        <IssuedCard
          credential={issued.credential}
          onDone={() => {
            openDialog('done');
          }}
        />
      ) : state === 'none' || !credential ? (
        <Card className="p-0 sm:p-0">
          <EmptyState
            className="py-12"
            icon={<Icon icon={Key01Icon} />}
            title={m.apiNoneTitle}
            description={m.apiNoneText}
            action={<CreateButton creating={creating} onCreate={() => void create()} />}
          />
        </Card>
      ) : state === 'revoked' ? (
        <RevokedCard
          credential={credential}
          action={<CreateButton creating={creating} onCreate={() => void create()} />}
        />
      ) : (
        <Dialog
          open={dialog === 'rotate' || dialog === 'revoke'}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <ActiveCredential credential={credential}>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  openDialog('rotate');
                }}
              >
                <Icon icon={ArrowReloadHorizontalIcon} />
                {m.apiRotate}
              </Button>
            </DialogTrigger>
            <DialogTrigger asChild>
              <Button
                variant="destructive-ghost"
                size="sm"
                onClick={() => {
                  openDialog('revoke');
                }}
              >
                <Icon icon={UnavailableIcon} />
                {m.apiRevoke}
              </Button>
            </DialogTrigger>
          </ActiveCredential>
          {dialog === 'revoke' ? (
            <RevokeDialogContent
              busy={dialogBusy}
              error={dialogError}
              onCloseAutoFocus={onCloseAutoFocus}
              onConfirm={() =>
                void runDialogAction('revoke', () => revokeRosterApiCredential({ data: { slug } }))
              }
            />
          ) : (
            <RotateDialogContent
              busy={dialogBusy}
              error={dialogError}
              onCloseAutoFocus={onCloseAutoFocus}
              onConfirm={() =>
                void runDialogAction('rotate', () => rotateRosterApiCredential({ data: { slug } }))
              }
            />
          )}
        </Dialog>
      )}
      <Dialog
        open={savedOpen}
        onOpenChange={(open) => {
          if (open) return;
          setDialog(null);
          if (blocker.status === 'blocked') blocker.reset();
        }}
      >
        <SavedDialogContent onConfirm={saved} onCloseAutoFocus={onCloseAutoFocus} />
      </Dialog>
    </Page>
  );
}

/** The way to the API documentation, for the IT team (not while a secret is on screen). */
function DocsButton() {
  return (
    <Button asChild variant="ghost">
      <Link to="/roster/api-access/docs">
        <Icon icon={File01Icon} />
        {m.apiDocsLink}
      </Link>
    </Button>
  );
}

function CreateButton({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  return (
    <Button size="sm" disabled={creating} aria-busy={creating || undefined} onClick={onCreate}>
      {creating ? (
        <>
          <Icon icon={Loading03Icon} className="animate-spin" />
          {m.apiCreating}
        </>
      ) : (
        <>
          <Icon icon={PlusSignIcon} />
          {m.apiCreate}
        </>
      )}
    </Button>
  );
}

/** The secret shown once, with everything the IT team needs to connect. */
function IssuedCard({
  credential,
  onDone,
}: {
  credential: RosterApiCredentialWithSecret;
  onDone: () => void;
}) {
  return (
    <Card className="p-0 sm:p-0">
      <div className="grid gap-5 p-5 sm:p-6">
        <Alert variant="warning">
          <Icon icon={Alert02Icon} />
          <AlertTitle>{m.apiSecretWarning}</AlertTitle>
          <AlertDescription>{m.apiSecretShare}</AlertDescription>
        </Alert>
        <CredentialField label={m.apiClientId} value={credential.clientId} />
        <CredentialField label={m.apiClientSecret} value={credential.secret} secret />
        <CredentialField label={m.apiTokenEndpoint} value={credential.tokenEndpoint} />
        <div className="grid justify-items-start gap-2">
          <span className="text-sm font-medium">{m.apiScope}</span>
          <ScopeCode scope={credential.scope} />
        </div>
        <p className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
          <Icon icon={InformationCircleIcon} className="size-3.5 shrink-0" />
          <span>
            {m.apiSendWith}{' '}
            <Link
              to="/roster/api-access/docs"
              className="rounded-sm font-medium text-foreground underline decoration-input underline-offset-3 outline-none hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {m.apiDocsLink}
            </Link>
            .
          </span>
        </p>
      </div>
      <div className="flex justify-end border-t px-5 py-4 sm:px-6">
        <Button onClick={onDone}>{m.apiDone}</Button>
      </div>
    </Card>
  );
}

function ScopeCode({ scope }: { scope: string }) {
  return <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[13.5px]">{scope}</code>;
}

function Never() {
  return <span className="font-normal text-muted-foreground">{m.apiNever}</span>;
}

function LastUsed({ at }: { at: string | null }) {
  if (!at) return <Never />;
  return (
    <>
      <time dateTime={at} title={formatDateTime(at)} suppressHydrationWarning>
        {formatRelativeTime(at)}
      </time>
      <span className="block text-[13px] font-normal text-muted-foreground">
        {formatDateTime(at)}
      </span>
    </>
  );
}

function ActiveCredential({
  credential,
  children,
}: {
  credential: RosterApiCredential;
  /** The actions under the details. */
  children: ReactNode;
}) {
  return (
    <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <SectionCard
        id="credentials"
        icon={Key01Icon}
        title={m.apiCardTitle}
        actions={
          <Badge variant="success">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {m.apiActive}
          </Badge>
        }
      >
        <DetailList>
          <DetailItem term={m.apiClientId}>
            <span className="-my-1.5 flex items-center gap-1">
              <span className="font-mono font-normal break-all">{credential.clientId}</span>
              <CopyButton
                value={credential.clientId}
                label={m.apiCopyLabel(m.apiClientId)}
                copiedMessage={m.apiCopied(m.apiClientId)}
                className="size-8"
              />
            </span>
          </DetailItem>
          <DetailItem term={m.apiCreated}>
            <time dateTime={credential.createdAt}>
              {m.apiCreatedOn(formatDate(credential.createdAt), credential.createdBy.name)}
            </time>
          </DetailItem>
          <DetailItem term={m.apiLastRotated}>
            {credential.rotatedAt ? (
              <time dateTime={credential.rotatedAt}>{formatDateTime(credential.rotatedAt)}</time>
            ) : (
              <Never />
            )}
          </DetailItem>
          <DetailItem term={m.apiLastUsed}>
            <LastUsed at={credential.lastUsedAt} />
          </DetailItem>
          <DetailItem term={m.apiScope}>
            <ScopeCode scope={ROSTER_WRITE_SCOPE} />
          </DetailItem>
        </DetailList>
        <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">{children}</div>
      </SectionCard>
      <div className="grid gap-4">
        <Card className="gap-2.5">
          <p className="text-sm text-secondary-foreground">{m.apiBatchesText}</p>
          <div>
            <Button asChild variant="secondary" size="sm">
              <Link to="/roster/imports">
                <Icon icon={Clock01Icon} />
                {m.apiHistory}
              </Link>
            </Button>
          </div>
        </Card>
        {credential.lastUsedAt ? null : (
          <Alert variant="info" role="status">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{m.apiNotUsedYet}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

function RevokedCard({
  credential,
  action,
}: {
  credential: RosterApiCredential;
  action: ReactNode;
}) {
  const revokedAt = credential.revokedAt ?? credential.createdAt;
  return (
    <SectionCard
      id="credentials"
      icon={Key01Icon}
      title={m.apiCardTitle}
      actions={
        <Badge variant="destructive">
          <Icon icon={UnavailableIcon} />
          {m.apiRevokedOn(formatDate(revokedAt))}
        </Badge>
      }
    >
      <DetailList>
        <DetailItem term={m.apiClientId}>
          <span className="font-mono font-normal break-all text-muted-foreground">
            {credential.clientId}
          </span>
        </DetailItem>
        <DetailItem term={m.apiRevoked}>
          <time dateTime={revokedAt}>{formatDateTime(revokedAt)}</time>
        </DetailItem>
        <DetailItem term={m.apiLastUsed}>
          <LastUsed at={credential.lastUsedAt} />
        </DetailItem>
      </DetailList>
      <p className="px-5 pt-1 pb-4 text-sm text-muted-foreground">{m.apiRevokedText}</p>
      <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">{action}</div>
    </SectionCard>
  );
}

function ApiAccessSkeleton() {
  return (
    <Page aria-busy="true" aria-label={m.apiTitle}>
      <PageHead title={m.apiTitle} />
      <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card className="gap-3.5">
          {Array.from({ length: 5 }, (_, line) => (
            <Skeleton key={line} />
          ))}
        </Card>
      </div>
    </Page>
  );
}
