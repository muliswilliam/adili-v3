import { Button, Card, Icon, ProgressBar } from '@adili/ui';
import {
  Archive02Icon,
  ArrowRight01Icon,
  CheckListIcon,
  LockIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { sectionKind } from '../../declaration/section-key';
import type { DeclarationSection } from '../../server/declarations/types';
import { CompletenessBadge } from './completeness-badge';
import {
  continueLabel,
  continueTarget,
  progress,
  relationship,
  SECTION_KINDS,
  stepLink,
} from './steps';
import { useWorkspace } from './workspace';

function sectionRow(section: DeclarationSection) {
  const kind = sectionKind(section.key);
  if (kind === null) return null;
  const { number, title } = SECTION_KINDS[kind];
  if (kind !== 'statement') return { number: String(number), label: title, sub: null };
  const you = section.key === 'statement:officer';
  return {
    number: String(number),
    label: `Financial statement: ${you ? 'you' : (section.personName ?? 'unnamed person')}`,
    sub: relationship(section.key),
  };
}

function Row({
  marker,
  label,
  sub,
  badge,
  link,
  muted,
}: {
  marker: ReactNode;
  label: string;
  sub?: string | null;
  badge?: ReactNode;
  link?: ReturnType<typeof stepLink>;
  muted?: boolean;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold text-secondary-foreground"
      >
        {marker}
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-medium">{label}</span>
        {sub ? <span className="text-[13px] text-muted-foreground">{sub}</span> : null}
      </span>
      {badge}
      {link ? <Icon icon={ArrowRight01Icon} className="size-4 text-muted-foreground" /> : null}
    </>
  );
  return (
    <li className={muted ? 'opacity-60' : undefined}>
      {link ? (
        <Link
          {...link}
          className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}

/**
 * The workspace's landing screen: progress, every section in First Schedule order with its
 * completeness, and Continue to the first section that is not complete.
 */
export function DeclarationOverview({ footer }: { footer?: ReactNode }) {
  const { declaration } = useWorkspace();
  const { sections } = declaration;
  const done = progress(sections);
  const target = continueTarget(sections);

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid flex-1 gap-0.5">
            <h2 className="text-lg font-semibold tracking-tight">{done.percent}% complete</h2>
            <p className="text-sm text-muted-foreground">
              {done.remaining === 0
                ? 'Check the summary, then submit.'
                : `${String(done.remaining)} ${done.remaining === 1 ? 'section' : 'sections'} left`}
            </p>
          </div>
          <Button asChild>
            <Link {...stepLink(declaration.id, target)}>
              {continueLabel(sections)}
              <Icon icon={ArrowRight01Icon} />
            </Link>
          </Button>
        </div>
        <ProgressBar
          label="Declaration progress"
          value={done.percent}
          size="sm"
          showValue={false}
        />
      </Card>

      <Card className="overflow-hidden p-0">
        <h2 className="sr-only">Sections</h2>
        <ol className="divide-y divide-border">
          {sections.map((section) => {
            const row = sectionRow(section);
            if (!row) return null;
            if (section.completeness === 'archived') {
              return (
                <Row
                  key={section.key}
                  muted
                  marker={<Icon icon={Archive02Icon} className="size-4" />}
                  label={row.label}
                  sub="Removed. Kept until you discard."
                  badge={<CompletenessBadge completeness="archived" />}
                />
              );
            }
            return (
              <Row
                key={section.key}
                marker={
                  section.completeness === 'complete' ? (
                    <Icon icon={Tick02Icon} className="size-4 text-success" />
                  ) : (
                    row.number
                  )
                }
                label={row.label}
                sub={row.sub}
                badge={<CompletenessBadge completeness={section.completeness} />}
                link={stepLink(declaration.id, section.key)}
              />
            );
          })}
          <Row
            marker={<Icon icon={CheckListIcon} className="size-4" />}
            label="Summary"
            sub="Check and submit"
            link={stepLink(declaration.id, 'summary')}
          />
        </ol>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Icon icon={LockIcon} className="size-4" />
          Only you can see your draft.
        </p>
        {footer}
      </div>
    </div>
  );
}
