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
  SiteHeader,
} from '@adili/ui';
import { createFileRoute } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  Calendar03Icon,
  FileValidationIcon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
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

const deadlines = [
  {
    title: 'Initial declaration',
    detail: 'Within 30 days of your appointment.',
  },
  {
    title: 'Biennial declaration',
    detail: 'Statement date 1 November, filed by 31 December of every odd year.',
  },
  {
    title: 'Final declaration',
    detail: 'Within 30 days of leaving public office.',
  },
];

function Landing({ error }: { error: string | null }) {
  return (
    <>
      <SiteHeader
        actions={
          <Button asChild size="sm">
            <a href="/auth/login">Sign in</a>
          </Button>
        }
      />
      <main className="flex-1">
        <section className="border-b bg-gradient-to-b from-muted/60 to-background">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div className="grid gap-6">
              {error ? (
                <Alert variant="destructive" className="max-w-xl">
                  <Icon icon={AlertCircleIcon} />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <p className="text-sm font-medium text-primary">For public officers</p>
              <h1 className="max-w-xl text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
                Declare your income, assets and liabilities
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
                Every public officer files a declaration for themselves, their spouses and dependent
                children under the Conflict of Interest Act, 2025. File online with your responsible
                Commission and receive an acknowledgement anyone can verify.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild>
                  <a href="/auth/login">Sign in to file</a>
                </Button>
                <p className="text-sm text-muted-foreground">Use your Adili Online account.</p>
              </div>
            </div>
            <Card className="lg:justify-self-end lg:w-full lg:max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon icon={Calendar03Icon} className="size-4 text-primary" />
                  When to declare
                </CardTitle>
                <CardDescription>Conflict of Interest Act, 2025</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-4">
                  {deadlines.map((deadline, index) => (
                    <li key={deadline.title} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-secondary-foreground">
                        {index + 1}
                      </span>
                      <div className="grid gap-0.5">
                        <p className="text-sm font-medium">{deadline.title}</p>
                        <p className="text-sm text-muted-foreground">{deadline.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2 sm:px-6">
          <Feature
            icon={<Icon icon={UserCheck01Icon} />}
            title="Verified identity"
            text="Your account is checked against the national population register before you file, so nobody can file in your name."
          />
          <Feature
            icon={<Icon icon={FileValidationIcon} />}
            title="Verifiable acknowledgement"
            text="Every submission receives a reference number and a QR code that confirms the acknowledgement is genuine."
          />
        </section>
      </main>
    </>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-secondary-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="grid gap-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </div>
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
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
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
    </>
  );
}
