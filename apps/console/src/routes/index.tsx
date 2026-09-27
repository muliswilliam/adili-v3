import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SiteHeader,
} from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Building2,
  CircleAlert,
  ClipboardCheck,
  FileBarChart2,
  Lock,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
import { ConsoleHeader } from '../components/console-header';
import { IdentityCard } from '../components/identity-card';
import { type Workspace, workspacesFor } from '../components/workspaces';
import { type DashboardViewer, getDashboardViewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ auth_error: z.string().optional() }),
  loader: () => getDashboardViewer(),
  component: Home,
});

function Home() {
  const viewer = Route.useLoaderData();
  const { auth_error } = Route.useSearch();
  return viewer ? <Dashboard viewer={viewer} /> : <Landing error={authErrorMessage(auth_error)} />;
}

function Landing({ error }: { error: string | null }) {
  return (
    <>
      <SiteHeader
        product="Console"
        actions={
          <Button asChild size="sm">
            <a href="/auth/login">Sign in</a>
          </Button>
        }
      />
      <main className="flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center">
          <div className="grid gap-6">
            {error ? (
              <Alert variant="destructive" className="max-w-xl">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm font-medium text-primary">For Commissions, employers and EACC</p>
            <h1 className="max-w-xl text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
              Oversee declarations and compliance
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
              Responsible Commissions review and verify the declarations filed with them, act on
              non-compliance and report to the Ethics and Anti-Corruption Commission.
            </p>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <a href="/auth/login">Sign in to the console</a>
                </Button>
                <p className="text-sm text-muted-foreground">Use your staff account.</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Activation link expired? Ask EACC to resend your invitation.
              </p>
            </div>
          </div>
          <ul className="grid gap-4">
            <Capability
              icon={<ClipboardCheck aria-hidden="true" />}
              title="Review and verify"
              text="Analyse declarations, request clarifications and record determinations, with a second officer approving every decision."
            />
            <Capability
              icon={<Building2 aria-hidden="true" />}
              title="Your organisation only"
              text="You see the declarants of your Commission and nothing else. Every read is recorded in the audit trail."
            />
            <Capability
              icon={<FileBarChart2 aria-hidden="true" />}
              title="Report to EACC"
              text="Compliance reports (Form M) are compiled from the data your Commission already holds."
            />
          </ul>
        </div>
      </main>
    </>
  );
}

function Capability({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-4 rounded-xl border bg-card p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="grid gap-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </li>
  );
}

function Dashboard({ viewer }: { viewer: DashboardViewer }) {
  const workspaces = viewer.directory.ok ? workspacesFor(viewer.directory.principal.roles) : [];
  return (
    <>
      <ConsoleHeader userName={viewer.user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div className="grid gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-muted-foreground">Signed in as {viewer.user.name}.</p>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <IdentityCard
            user={viewer.user}
            directory={viewer.directory}
            organisation={viewer.organisation}
          />
          <Card>
            <CardHeader>
              <CardTitle>Your workspaces</CardTitle>
              <CardDescription>Areas of the console your roles give you access to.</CardDescription>
            </CardHeader>
            <CardContent>
              {workspaces.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {workspaces.map((workspace) => (
                    <li key={workspace.id} className="grid">
                      <WorkspaceCard workspace={workspace} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
                  <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-medium">No staff roles</p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Your account has no console access. Declarants file through the portal.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  if (!workspace.href) {
    return (
      <div className="grid content-start gap-2 rounded-lg border p-4" aria-disabled="true">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold">{workspace.title}</h2>
          <Badge variant="neutral" className="shrink-0">
            Not yet available
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{workspace.description}</p>
      </div>
    );
  }
  return (
    <Link
      to={workspace.href}
      className="group grid content-start gap-2 rounded-lg border p-4 transition-colors outline-none hover:border-primary/40 hover:bg-primary-subtle/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">{workspace.title}</h2>
        {workspace.readOnly ? (
          <Badge variant="neutral" className="shrink-0">
            Read only
          </Badge>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{workspace.description}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
        Open
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}
