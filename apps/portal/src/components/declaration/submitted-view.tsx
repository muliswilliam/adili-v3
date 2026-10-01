import {
  Button,
  Card,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  Icon,
  LateBadge,
  ReferenceChip,
  useToday,
  VersionBadge,
} from '@adili/ui';
import {
  File01Icon,
  Message01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { referenceParts } from '../../declaration/reference-parts';
import type { Declaration, DeclarationVersion } from '../../server/declarations/types';
import { SlipCard, type SlipCardProps } from './slip-card';

/** Copy of the success page (spec 06 FE-3). */
export const SUBMITTED_COPY = {
  title: 'Declaration submitted',
  // A no-break space keeps "version" and its number on one line.
  received: (commission: string, version: number) =>
    `Received by ${commission}${version > 1 ? `, replacing version\u00A0${String(version - 1)}` : ''}. Keep your reference number.`,
  submittedAt: (at: string) => `Submitted ${formatDateTime(at)}`,
  home: 'Home',
  myDeclarations: 'My declarations',
  nextTitle: 'What happens next',
  nextReview: 'Your Commission reviews your declaration within the statutory windows.',
  nextClarification:
    'You may be asked for clarification within six months, and you have 30 days to reply.',
  nextAmend: (dueDate: string) => `You can amend until ${formatDate(dueDate)}.`,
} as const;

/**
 * The "What happens next" lines: review, a possible clarification, and amending until the due
 * date, which is left out once the due date has passed (Kenyan calendar date).
 */
export function nextSteps(dueDate: string, now: number): string[] {
  const steps: string[] = [SUBMITTED_COPY.nextReview, SUBMITTED_COPY.nextClarification];
  if (formatCalendarDate(now) <= dueDate) steps.push(SUBMITTED_COPY.nextAmend(dueDate));
  return steps;
}

export interface SubmittedViewProps {
  declaration: Declaration;
  /** The newest submitted version. */
  version: DeclarationVersion;
  /** The verify app's origin and where the slip was sent. */
  slip: SlipCardProps['context'];
  /** Today, for the amend line; the real clock when left out. */
  now?: number;
}

const NEXT_ICONS = [File01Icon, Message01Icon, PencilEdit02Icon];

/**
 * The submission success page (spec 06 FE-3): the reference number with its breakdown and a
 * copy button, the version, when it was submitted and whether late, the acknowledgement slip as
 * it gets prepared, then what happens next.
 */
export function SubmittedView({ declaration, version, slip, now }: SubmittedViewProps) {
  const today = useToday(now);
  return (
    <div>
      <header className="flex flex-col items-center pt-2 pb-[26px] text-center">
        <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-success-subtle text-success">
          <Icon icon={Tick02Icon} className="size-8" strokeWidth={2.4} />
        </span>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">
          {SUBMITTED_COPY.title}
        </h1>
        <p className="mt-1.5 max-w-[480px] text-muted-foreground">
          {SUBMITTED_COPY.received(declaration.commission.name, version.version)}
        </p>
        <div className="mt-[18px]">
          <ReferenceChip
            size="lg"
            reference={version.reference}
            parts={referenceParts(version.reference, declaration.commission.name)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground">
          <VersionBadge version={version.version} />
          <span>{SUBMITTED_COPY.submittedAt(version.submittedAt)}</span>
          {version.late ? <LateBadge /> : null}
        </div>
      </header>
      <SlipCard declaration={declaration} version={version} context={slip} />
      <Card asChild className="mt-5">
        <section aria-labelledby="next-heading">
          <h2 id="next-heading" className="text-base font-semibold tracking-[-0.01em]">
            {SUBMITTED_COPY.nextTitle}
          </h2>
          <ul className="mt-3.5 grid gap-3.5">
            {nextSteps(declaration.dueDate, today).map((step, index) => (
              <li key={step} className="flex items-start gap-3.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-secondary-foreground">
                  <Icon
                    icon={NEXT_ICONS[index] ?? File01Icon}
                    className="size-3.5"
                    strokeWidth={2.2}
                  />
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ul>
        </section>
      </Card>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Button asChild variant="secondary">
          <Link to="/">{SUBMITTED_COPY.home}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/declarations">{SUBMITTED_COPY.myDeclarations}</Link>
        </Button>
      </div>
    </div>
  );
}
