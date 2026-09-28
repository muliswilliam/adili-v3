import {
  Alert,
  AlertDescription,
  Button,
  Icon,
  SiteFooter,
  SiteHeader,
  ToastProvider,
} from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertCircleIcon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
import { AuthShell } from '../components/auth-shell';
import { DashboardCards } from '../components/dashboard/dashboard-cards';
import { ObligationsSection } from '../components/dashboard/obligations-view';
import { SignOutButton } from '../components/sign-out-button';
import { getMyObligations, getObligationDetail } from '../server/obligations';
import type { MyObligationsResult } from '../server/obligations.server';
import { getViewer, type Viewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ auth_error: z.string().optional() }),
  loader: async () => {
    const viewer = await getViewer();
    // Not awaited: the dashboard renders with skeleton cards and the obligations stream in.
    return { viewer, obligations: viewer ? getMyObligations() : null };
  },
  component: Home,
});

const reloadObligations = () => getMyObligations();
const loadObligationDetail = (id: string) => getObligationDetail({ data: { id } });

function Home() {
  const { viewer, obligations } = Route.useLoaderData();
  const { auth_error } = Route.useSearch();
  return viewer && obligations ? (
    <Dashboard viewer={viewer} obligations={obligations} />
  ) : (
    <Landing error={authErrorMessage(auth_error)} />
  );
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
  obligations,
}: {
  viewer: Viewer;
  obligations: Promise<MyObligationsResult>;
}) {
  const firstName = viewer.user.name.split(' ')[0];
  return (
    <ToastProvider>
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
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
        <div className="mt-8">
          <DashboardCards
            viewer={viewer}
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
      <SiteFooter />
    </ToastProvider>
  );
}
