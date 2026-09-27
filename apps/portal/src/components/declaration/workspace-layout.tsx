import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  SaveIndicator,
  type SaveStatus,
  SectionNav,
  type SectionNavSection,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckListIcon,
  LeftToRightListBulletIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import type { AutosaveStatus } from './autosave';
import { OBLIGATION_TYPE_LABELS } from './labels';
import { navEntries, neighbours, type Step, stepForNavEntry, stepLink, stepTitle } from './steps';
import { useWorkspace } from './workspace';
import { WorkspaceHeader } from './workspace-header';

export const CONFLICT_COPY =
  'This declaration was changed on another device or tab. Reload to continue; your last saved work is kept.';
export const RELOADED_COPY = 'Reloaded the latest saved version';

function indicator(status: AutosaveStatus): {
  status: SaveStatus;
  messages?: Partial<Record<SaveStatus, string>>;
} {
  // A refused save is not retried; say so instead of "retrying".
  if (status === 'rejected')
    return { status: 'retrying', messages: { retrying: 'Could not save' } };
  return { status };
}

function navSections(sections: ReturnType<typeof navEntries>): SectionNavSection[] {
  return sections.map((entry) => ({
    id: entry.id,
    label: entry.label,
    ...(entry.status ? { status: entry.status } : {}),
    ...(entry.hint ? { hint: entry.hint } : {}),
    ...(entry.id === 'summary'
      ? { marker: <Icon icon={CheckListIcon} strokeWidth={2} className="size-3.5" /> }
      : {}),
    ...(entry.persons ? { sections: entry.persons } : {}),
  }));
}

/**
 * The chrome around every workspace screen: section navigation with the save indicator (a
 * sidebar on wide screens, a Sections dialog on phones), the conflict bar, the header, the
 * screen itself inside a fieldset that is disabled while there is a conflict, and back/next.
 */
export function WorkspaceLayout({ step, children }: { step: Step; children: ReactNode }) {
  const { declaration, autosave, conflict, reload } = useWorkspace();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const { sections } = declaration;
  const entries = navSections(navEntries(sections));
  const save = indicator(autosave.status);
  const { back, next } = neighbours(sections, step);
  const typeLabel = `${OBLIGATION_TYPE_LABELS[declaration.type]} declaration`;

  function open(target: Step) {
    setSectionsOpen(false);
    void navigate(stepLink(declaration.id, target));
  }

  async function onReload() {
    setReloading(true);
    try {
      await reload();
      toast({ title: RELOADED_COPY });
    } finally {
      setReloading(false);
    }
  }

  const saveIndicator = (
    <SaveIndicator status={save.status} {...(save.messages ? { messages: save.messages } : {})} />
  );

  const nav = (
    <SectionNav
      label="Declaration sections"
      sections={entries}
      current={step}
      onSelect={(id) => {
        open(stepForNavEntry(id));
      }}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-4 pb-24 sm:px-6 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-11 lg:pt-8">
      <aside className="hidden lg:block">
        <div className="sticky top-6 grid gap-4">
          <Button asChild variant="ghost" size="sm" className="justify-self-start">
            <Link to="/">
              <Icon icon={ArrowLeft01Icon} />
              My declarations
            </Link>
          </Button>
          <Link
            {...stepLink(declaration.id, 'overview')}
            aria-current={step === 'overview' ? 'page' : undefined}
            className="grid rounded-md px-2.5 py-1.5 outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
          >
            <span className="text-sm font-semibold">{typeLabel}</span>
            <span className="text-[13px] text-muted-foreground">
              To {declaration.commission.name}
            </span>
          </Link>
          {nav}
          <div className="border-t border-border pt-4">{saveIndicator}</div>
        </div>
      </aside>

      <div className="grid min-w-0 content-start gap-6">
        <div className="flex items-center gap-3 border-b border-border pb-3 lg:hidden">
          <Button asChild variant="ghost" size="icon">
            <Link {...stepLink(declaration.id, 'overview')} aria-label="Declaration overview">
              <Icon icon={ArrowLeft01Icon} />
            </Link>
          </Button>
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-semibold">
              {typeLabel} · {declaration.commission.issuerCode}
            </span>
            {saveIndicator}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSectionsOpen(true);
            }}
          >
            <Icon icon={LeftToRightListBulletIcon} />
            Sections
          </Button>
        </div>
        <Dialog open={sectionsOpen} onOpenChange={setSectionsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Sections</DialogTitle>
              <DialogDescription>
                {typeLabel} · {declaration.commission.issuerCode}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <Button
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  open('overview');
                }}
              >
                Overview
              </Button>
              {nav}
            </DialogBody>
          </DialogContent>
        </Dialog>

        {conflict ? (
          <Alert variant="destructive" className="flex flex-wrap items-center gap-3">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription className="min-w-0 flex-1">{CONFLICT_COPY}</AlertDescription>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={reloading}
              onClick={() => void onReload()}
            >
              <Icon icon={RefreshIcon} />
              Reload
            </Button>
          </Alert>
        ) : null}

        <WorkspaceHeader declaration={declaration} title={stepTitle(sections, step)} />

        <fieldset disabled={conflict} className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">{stepTitle(sections, step)}</legend>
          {children}
        </fieldset>

        {back || next ? (
          <nav
            aria-label="Previous and next"
            className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-border bg-background px-4 py-3 sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:pt-6"
          >
            {back ? (
              <Button asChild variant="secondary">
                <Link {...stepLink(declaration.id, back.step)} aria-label={`Back: ${back.label}`}>
                  <Icon icon={ArrowLeft01Icon} />
                  <span className="hidden sm:inline">{back.label}</span>
                </Link>
              </Button>
            ) : null}
            {next ? (
              <Button asChild className="flex-1 sm:ml-auto sm:flex-none">
                <Link {...stepLink(declaration.id, next.step)}>
                  {next.label}
                  <Icon icon={ArrowRight01Icon} />
                </Link>
              </Button>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
