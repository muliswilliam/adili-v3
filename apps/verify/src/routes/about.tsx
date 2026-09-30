import { Button, Card, Icon } from '@adili/ui';
import {
  ArrowLeft01Icon,
  Clock01Icon,
  SquareLock02Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { verifyMessages as copy } from '../copy';

export const Route = createFileRoute('/about')({
  head: () => ({ meta: [{ title: copy.aboutTitle }] }),
  component: About,
});

const LEVELS = [
  [copy.aboutRestricted, copy.aboutRestrictedExamples, copy.aboutRestrictedShows],
  [copy.aboutConfidential, copy.aboutConfidentialExamples, copy.aboutConfidentialShows],
  [copy.aboutPublic, copy.aboutPublicExamples, copy.aboutPublicShows],
] as const;

/** What the result page shows for each disclosure level (ADR-010) and what a check records. */
function About() {
  return (
    <div className="grid gap-4">
      <Button asChild variant="ghost" size="sm" className="-mt-1.5 -ml-2.5 justify-self-start">
        <Link to="/">
          <Icon icon={ArrowLeft01Icon} />
          {copy.back}
        </Link>
      </Button>
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance">
          {copy.aboutHeading}
        </h1>
        <p className="mt-2 text-muted-foreground">{copy.aboutIntro}</p>
      </div>
      <Card className="mt-2 overflow-hidden p-0 sm:p-0">
        <h2 className="border-b px-5 py-4 text-[15px] font-semibold">{copy.aboutSee}</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] sm:text-sm">
            <thead>
              <tr className="border-b text-left text-[12.5px] text-muted-foreground">
                <th scope="col" className="px-2.5 py-2.5 sm:px-3 font-medium">
                  {copy.aboutKind}
                </th>
                <th scope="col" className="px-2.5 py-2.5 sm:px-3 font-medium">
                  {copy.aboutExamples}
                </th>
                <th scope="col" className="px-2.5 py-2.5 sm:px-3 font-medium">
                  {copy.aboutShows}
                </th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map(([kind, examples, shows]) => (
                <tr key={kind} className="border-b align-top last:border-b-0">
                  <th scope="row" className="px-2.5 py-2.5 sm:px-3 text-left font-semibold">
                    {kind}
                  </th>
                  <td className="px-2.5 py-2.5 sm:px-3">{examples}</td>
                  <td className="px-2.5 py-2.5 sm:px-3">{shows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <h2 className="text-base font-semibold tracking-[-0.01em]">{copy.aboutNever}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{copy.aboutNeverDetail}</p>
      </Card>
      <Card>
        <h2 className="text-base font-semibold tracking-[-0.01em]">{copy.aboutRecord}</h2>
        <ul className="mt-3 grid gap-2.5 text-[14.5px]">
          <RecordItem icon={Clock01Icon}>{copy.aboutRecordChecks}</RecordItem>
          <RecordItem icon={UserMultipleIcon}>{copy.aboutRecordOwner}</RecordItem>
          <RecordItem icon={SquareLock02Icon} className="bg-success-subtle text-success">
            {copy.aboutRecordFiles}
          </RecordItem>
        </ul>
      </Card>
    </div>
  );
}

function RecordItem({
  icon,
  className = 'bg-muted text-secondary-foreground',
  children,
}: {
  icon: typeof Clock01Icon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`flex size-[30px] shrink-0 items-center justify-center rounded-lg ${className}`}
      >
        <Icon icon={icon} />
      </span>
      <span className="pt-1">{children}</span>
    </li>
  );
}
