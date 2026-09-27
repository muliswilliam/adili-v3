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
  Icon,
  SiteFooter,
  SiteHeader,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  Building03Icon,
  ClipboardCheckIcon,
  FileChartColumnIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
import { IdentityCard } from '../components/identity-card';
import { NoStaffRoles } from '../components/no-staff-roles';
import { Page } from '../components/page';
import { ConsoleShell } from '../components/shell/console-shell';
import { type Workspace, workspacesFor } from '../components/workspaces';
import { getViewer, type Viewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ auth_error: z.string().optional() }),
  loader: () => getViewer(),
  staticData: { crumb: 'Home' },
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
                <Icon icon={AlertCircleIcon} />
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
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild>
                <a href="/auth/login">Sign in to the console</a>
              </Button>
              <p className="text-sm text-muted-foreground">Use your staff account.</p>
            </div>
          </div>
          <ul className="grid gap-4">
            <Capability
              icon={<Icon icon={ClipboardCheckIcon} />}
              title="Review and verify"
              text="Analyse declarations, request clarifications and record determinations, with a second officer approving every decision."
            />
            <Capability
              icon={<Icon icon={Building03Icon} />}
              title="Your organisation only"
              text="You see the declarants of your Commission and nothing else. Every read is recorded in the audit trail."
            />
            <Capability
              icon={<Icon icon={FileChartColumnIcon} />}
              title="Report to EACC"
              text="Compliance reports (Form M) are compiled from the data your Commission already holds."
            />
          </ul>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Capability({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-4 rounded-xl border bg-card p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-secondary-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="grid gap-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </li>
  );
}

function Dashboard({ viewer }: { viewer: Viewer }) {
  const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
  const workspaces = workspacesFor(roles);
  return (
    <ConsoleShell userName={viewer.user.name} roles={roles}>
      <Page>
        <div className="grid gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
          <p className="text-muted-foreground">Signed in as {viewer.user.name}.</p>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <IdentityCard user={viewer.user} directory={viewer.directory} />
          <Card>
            <CardHeader>
              <CardTitle>Your workspaces</CardTitle>
              <CardDescription>Areas of the console your roles give you access to.</CardDescription>
            </CardHeader>
            <CardContent>
              {workspaces.length > 0 ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {workspaces.map((workspace) => (
                    <WorkspaceCard key={workspace.id} workspace={workspace} />
                  ))}
                </ul>
              ) : (
                <NoStaffRoles />
              )}
            </CardContent>
          </Card>
        </div>
      </Page>
    </ConsoleShell>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  if (workspace.href) {
    return (
      <li className="relative grid content-start gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/60">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold">
            <Link
              to={workspace.href}
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {workspace.title}
            </Link>
          </h2>
          <Icon icon={ArrowRight01Icon} className="text-muted-foreground" />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{workspace.description}</p>
      </li>
    );
  }
  return (
    <li className="grid content-start gap-2 rounded-lg border p-4" aria-disabled="true">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">{workspace.title}</h2>
        <Badge className="shrink-0">Not yet available</Badge>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{workspace.description}</p>
    </li>
  );
}
