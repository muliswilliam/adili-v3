import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Icon,
  SiteFooter,
  SiteHeader,
} from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertCircleIcon, ArrowRight01Icon, Calendar03Icon } from '@hugeicons/core-free-icons';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
import { AuthShell } from '../components/auth-shell';
import { IdentityCard } from '../components/identity-card';
import { SignOutButton } from '../components/sign-out-button';
import { getViewer, type Viewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ auth_error: z.string().optional() }),
  loader: () => getViewer(),
  component: Home,
});

function Home() {
  const viewer = Route.useLoaderData();
  const { auth_error } = Route.useSearch();
  return viewer ? <Dashboard viewer={viewer} /> : <Landing error={authErrorMessage(auth_error)} />;
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

function Dashboard({ viewer }: { viewer: Viewer }) {
  const firstName = viewer.user.name.split(' ')[0];
  return (
    <>
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
          <h1 className="text-lg font-semibold tracking-tight">Welcome, {firstName}</h1>
          <p className="text-muted-foreground">
            Your declarations and filing obligations will appear here.
          </p>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <IdentityCard user={viewer.user} directory={viewer.directory} />
          <Card>
            <CardHeader>
              <CardTitle>Filing obligations</CardTitle>
              <CardDescription>Declarations you are required to file.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
                <Icon icon={Calendar03Icon} className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No obligations yet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Obligations appear here when a declaration falls due under your Commission's
                  roster.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
