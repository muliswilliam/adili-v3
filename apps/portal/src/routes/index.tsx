import {
  Alert,
  AlertDescription,
  Button,
  cn,
  Icon,
  SiteFooter,
  SiteHeader,
  textLink,
  ToastProvider,
  useToast,
} from '@adili/ui';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { AlertCircleIcon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { AskAdiliLauncher, AskAdiliProvider } from '../components/assistant/ask-adili';
import { authErrorMessage } from '../components/auth-error';
import { AuthShell } from '../components/auth-shell';
import { DashboardCards } from '../components/dashboard/dashboard-cards';
import { orUnavailable } from '../components/dashboard/obligations';
import { ObligationsSection } from '../components/dashboard/obligations-view';
import { DISCARDED_TOAST } from '../components/declaration/discard-dialog';
import { SignOutButton } from '../components/sign-out-button';
import { HelpLink } from '../components/help/parts';
import { myClarificationsOrUnavailable, type MyClarificationsLoad } from '../server/clarifications';
import { getMyNotices, type MyNoticesLoad } from '../server/notices';
import { getMyDecisionLetter, getMyDecisions, type MyDecisionsLoad } from '../server/decisions';
import { getMyDeclarations } from '../server/declarations';
import type { DeclarationListResult } from '../server/declarations.server';
import { getMyAccessNotices, type NoticesLoad } from '../server/access-notices';
import { isSignedInApplicant } from '../server/access-requests';
import { getMyObligations, getObligationDetail } from '../server/obligations';
import type { MyObligationsResult } from '../server/obligations.server';
import { getViewer, type Viewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({
    auth_error: z.string().optional(),
    discarded: z.boolean().optional(),
  }),
  loader: async () => {
    const viewer = await getViewer();
    // Applicants (Form K, spec 10) have no declarant record: their home is My requests.
    if (viewer?.declarant.status === 'not-declarant' && (await isSignedInApplicant())) {
      throw redirect({ to: '/access/requests' });
    }
    // Not awaited: the dashboard renders with skeleton cards, and the obligations, the
    // declarations, the clarifications, the notices and the access notices stream in, each on
    // its own.
    const obligations = viewer ? orUnavailable(getMyObligations()) : null;
    const onboarded = viewer?.declarant.status === 'onboarded';
    const declarations = onboarded ? loadDeclarations() : null;
    const clarifications = onboarded ? myClarificationsOrUnavailable() : null;
    const accessNotices = onboarded ? loadAccessNotices() : null;
    const notices = onboarded ? loadNotices() : null;
    const decisions = onboarded ? loadDecisions() : null;
    return {
      viewer,
      obligations,
      declarations,
      clarifications,
      accessNotices,
      notices,
      decisions,
    };
  },
  component: Home,
});

const reloadObligations = () => orUnavailable(getMyObligations());
const loadObligationDetail = (id: string) => getObligationDetail({ data: { id } });

/** The declarant's declarations; an ended session or a failed call reads as unavailable. */
async function loadDeclarations(): Promise<DeclarationListResult> {
  const declarations = await getMyDeclarations().catch(() => ({ status: 'unavailable' }) as const);
  return declarations.status === 'unauthenticated' ? { status: 'unavailable' } : declarations;
}

/** Requests to see the declaration; an ended session or a failed call reads as unavailable. */
async function loadAccessNotices(): Promise<NoticesLoad> {
  const now = new Date().toISOString();
  const notices = await getMyAccessNotices().catch(() => ({ status: 'unavailable', now }) as const);
  return notices.status === 'unauthenticated' ? { status: 'unavailable', now } : notices;
}

/** The declarant's decisions; an ended session or a failed call reads as unavailable. */
async function loadDecisions(): Promise<MyDecisionsLoad> {
  const load = await getMyDecisions().catch(() => ({ status: 'unavailable' }) as const);
  return load.status === 'unauthenticated' ? { status: 'unavailable' } : load;
}

const loadDecisionLetter = (determinationId: string) =>
  getMyDecisionLetter({ data: { determinationId } });

/** Notices to comply and warnings; an ended session or a failed call reads as unavailable. */
async function loadNotices(): Promise<MyNoticesLoad> {
  const load = await getMyNotices().catch(
    () => ({ status: 'unavailable', now: new Date().toISOString() }) as const,
  );
  return load.status === 'unauthenticated' ? { status: 'unavailable', now: load.now } : load;
}

function Home() {
  const { viewer, obligations, declarations, clarifications, accessNotices, notices, decisions } =
    Route.useLoaderData();
  const { auth_error, discarded } = Route.useSearch();
  return viewer && obligations ? (
    <Dashboard
      viewer={viewer}
      obligations={obligations}
      declarations={declarations}
      accessNotices={accessNotices}
      clarifications={clarifications}
      notices={notices}
      decisions={decisions}
      discarded={discarded === true}
    />
  ) : (
    <Landing error={authErrorMessage(auth_error)} />
  );
}

/** Confirms a draft discarded in the workspace, which sends the declarant here. */
function DiscardedToast() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast({ title: DISCARDED_TOAST });
    void navigate({ to: '/', search: {}, replace: true });
  }, [toast, navigate]);
  return null;
}

function Landing({ error }: { error: string | null }) {
  return (
    <AuthShell art="landing">
      {error ? (
        <Alert variant="destructive" className="mb-6">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <h1 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">
        Declare your income, assets and liabilities online
      </h1>
      <p className="mt-2 text-muted-foreground">For public officers, on your phone or computer.</p>
      <div className="mt-[26px] grid gap-2.5">
        <Button asChild className="w-full">
          <Link to="/get-started">
            Get started
            <Icon icon={ArrowRight01Icon} />
          </Link>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <a href="/auth/login">Sign in</a>
        </Button>
      </div>
      <p className="mt-3 text-[13.5px] text-muted-foreground">
        First time here? You need your personnel file number and national ID.
      </p>
      <p className="mt-7 border-t pt-4 text-[13.5px] text-muted-foreground">
        Not a public officer?{' '}
        <Link to="/access" className={cn(textLink, 'font-medium')}>
          Request access to a declaration
        </Link>
      </p>
    </AuthShell>
  );
}

function Dashboard({
  viewer,
  obligations,
  declarations,
  accessNotices,
  clarifications,
  notices,
  decisions,
  discarded,
}: {
  viewer: Viewer;
  obligations: Promise<MyObligationsResult>;
  declarations: Promise<DeclarationListResult> | null;
  accessNotices: Promise<NoticesLoad> | null;
  clarifications: Promise<MyClarificationsLoad> | null;
  notices: Promise<MyNoticesLoad> | null;
  decisions: Promise<MyDecisionsLoad> | null;
  discarded: boolean;
}) {
  const firstName = viewer.user.name.split(' ')[0];
  const main = (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
      <div className="mt-8">
        <DashboardCards
          viewer={viewer}
          declarations={declarations}
          accessNotices={accessNotices}
          clarifications={clarifications}
          notices={notices}
          decisions={decisions}
          loadDecisionLetter={loadDecisionLetter}
          obligations={
            <ObligationsSection
              obligations={obligations}
              reload={reloadObligations}
              loadDetail={loadObligationDetail}
            />
          }
        />
      </div>
    </main>
  );
  return (
    <ToastProvider>
      {discarded ? <DiscardedToast /> : null}
      <SiteHeader
        actions={
          <>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {viewer.user.name}
            </span>
            {/* Help search is for declarants: an applicant's Commission is not known yet. */}
            {viewer.declarant.status === 'onboarded' ? <HelpLink /> : null}
            <SignOutButton />
          </>
        }
      />
      {viewer.declarant.status === 'onboarded' ? (
        // Ask Adili outside a draft (spec 11): for declarants, who have a Commission to ask about.
        <AskAdiliProvider declarationId={null} step="home">
          {main}
          <SiteFooter />
          <AskAdiliLauncher />
        </AskAdiliProvider>
      ) : (
        <>
          {main}
          <SiteFooter />
        </>
      )}
    </ToastProvider>
  );
}
