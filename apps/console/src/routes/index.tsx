import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardDescription,
  CardIcon,
  Icon,
  type IconProps,
  SiteFooter,
  SiteHeader,
} from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  ArrowRight02Icon,
  Building03Icon,
  Calendar03Icon,
  CheckmarkBadge01Icon,
  ClipboardCheckIcon,
  CustomerSupportIcon,
  FileChartColumnIcon,
  FileLockedIcon,
  Home01Icon,
  Search01Icon,
  Settings01Icon,
  TaskDone01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { authErrorMessage } from '../components/auth-error';
import { IdentityCard } from '../components/identity-card';
import { NoStaffRoles } from '../components/load-error';
import { Page, PageHead } from '../components/page';
import { rosterNavCounts } from '../components/roster/nav-counts';
import { ConsoleShell } from '../components/shell/console-shell';
import { type Workspace, workspacesFor } from '../components/workspaces';
import { type DashboardViewer, getDashboardViewer } from '../server/viewer';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ auth_error: z.string().optional() }),
  loader: () => getDashboardViewer(),
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
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild>
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
    <li>
      <Card className="flex-row gap-4">
        <CardIcon className="mb-0 shrink-0">{icon}</CardIcon>
        <div className="grid gap-1">
          <h2 className="font-semibold">{title}</h2>
          <CardDescription className="leading-relaxed">{text}</CardDescription>
        </div>
      </Card>
    </li>
  );
}

function Dashboard({ viewer }: { viewer: DashboardViewer }) {
  const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
  const workspaces = workspacesFor(roles);
  return (
    <ConsoleShell
      userName={viewer.user.name}
      roles={roles}
      navCounts={rosterNavCounts(viewer.roster)}
    >
      <Page>
        <PageHead title="Overview">
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {viewer.user.name}.</p>
        </PageHead>
        <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-labelledby="workspaces-title" className="grid gap-3">
            <h2 id="workspaces-title" className="sr-only">
              Your workspaces
            </h2>
            {workspaces.length > 0 ? (
              <ul className="grid gap-3.5 min-[760px]:grid-cols-2">
                {workspaces.map((workspace) => (
                  <WorkspaceCard key={workspace.id} workspace={workspace} />
                ))}
              </ul>
            ) : (
              <NoStaffRoles />
            )}
          </section>
          <IdentityCard
            user={viewer.user}
            directory={viewer.directory}
            organisation={viewer.organisation}
          />
        </div>
      </Page>
    </ConsoleShell>
  );
}

const WORKSPACE_ICONS: Record<string, IconProps['icon']> = {
  commissions: Building03Icon,
  review: TaskDone01Icon,
  approvals: CheckmarkBadge01Icon,
  access: FileLockedIcon,
  roster: UserGroupIcon,
  obligations: Calendar03Icon,
  commission: Home01Icon,
  compliance: FileChartColumnIcon,
  audit: Search01Icon,
  support: CustomerSupportIcon,
  platform: Settings01Icon,
};

/** A workspace as the prototype's `.ws` card: icon tile, title, description and "Open". */
function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const icon = WORKSPACE_ICONS[workspace.id] ?? Building03Icon;
  if (!workspace.href) {
    return (
      <li className="flex min-h-[150px] flex-col gap-2.5 rounded-2xl bg-card p-5 shadow-card">
        <CardIcon className="mb-0 size-[38px] text-muted-foreground [&_svg]:size-[19px]">
          <Icon icon={icon} />
        </CardIcon>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold tracking-[-0.01em]">{workspace.title}</h3>
          <Badge>Not yet available</Badge>
        </div>
        <p className="text-sm leading-[1.45] text-muted-foreground">{workspace.description}</p>
      </li>
    );
  }
  return (
    <li className="relative flex min-h-[150px] flex-col gap-2.5 rounded-2xl bg-card p-5 shadow-card transition-shadow hover:shadow-[0_0_0_1px_var(--input),0_6px_20px_-8px_rgb(0_0_0/0.15)]">
      <CardIcon className="mb-0 size-[38px] bg-brand-subtle text-brand-subtle-foreground [&_svg]:size-[19px]">
        <Icon icon={icon} />
      </CardIcon>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold tracking-[-0.01em]">
          <Link
            to={workspace.href}
            className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            {workspace.title}
          </Link>
        </h3>
        {workspace.readOnly ? <Badge>Read only</Badge> : null}
      </div>
      <p className="text-sm leading-[1.45] text-muted-foreground">{workspace.description}</p>
      <span
        aria-hidden="true"
        className="mt-auto flex items-center gap-1 text-[13.5px] font-medium"
      >
        Open
        <Icon icon={ArrowRight02Icon} className="size-[15px]" />
      </span>
    </li>
  );
}
