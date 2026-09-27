import {
  Alert,
  AlertDescription,
  Button,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
  useToast,
} from '@adili/ui';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertCircleIcon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
import { AuthShell } from '../components/auth-shell';
import { DashboardCards } from '../components/dashboard/dashboard-cards';
import { DISCARDED_TOAST } from '../components/declaration/discard-dialog';
import { SignOutButton } from '../components/sign-out-button';
import type { DashboardWork } from '../components/dashboard/obligations-card';
import { getMyDeclarations, getMyObligations } from '../server/declarations';
import { getViewer, type Viewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({
    auth_error: z.string().optional(),
    discarded: z.boolean().optional(),
  }),
  loader: async () => {
    const viewer = await getViewer();
    return { viewer, work: viewer?.declarant.status === 'onboarded' ? await loadWork() : null };
  },
  component: Home,
});

/** The declarant's obligations and declarations; an ended session reads as unavailable. */
async function loadWork(): Promise<DashboardWork> {
  const [obligations, declarations] = await Promise.all([getMyObligations(), getMyDeclarations()]);
  return {
    obligations: obligations.status === 'unauthenticated' ? { status: 'unavailable' } : obligations,
    declarations:
      declarations.status === 'unauthenticated' ? { status: 'unavailable' } : declarations,
  };
}

function Home() {
  const { viewer, work } = Route.useLoaderData();
  const { auth_error, discarded } = Route.useSearch();
  return viewer ? (
    <Dashboard viewer={viewer} work={work} discarded={discarded === true} />
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
    </AuthShell>
  );
}

function Dashboard({
  viewer,
  work,
  discarded,
}: {
  viewer: Viewer;
  work: DashboardWork | null;
  discarded: boolean;
}) {
  const firstName = viewer.user.name.split(' ')[0];
  return (
    <ToastProvider>
      {discarded ? <DiscardedToast /> : null}
      <SiteHeader
        actions={
          <>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {viewer.user.name}
            </span>
            <SignOutButton />
          </>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="grid gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
          <p className="text-muted-foreground">
            Your declarations and filing obligations will appear here.
          </p>
        </div>
        <div className="mt-8">
          <DashboardCards viewer={viewer} work={work} />
        </div>
      </main>
      <SiteFooter />
    </ToastProvider>
  );
}
