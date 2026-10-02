import { Button, cn, focusRing, Icon, Tooltip } from '@adili/ui';
import {
  ArrowLeft01Icon,
  InformationCircleIcon,
  SquareLock01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { TRANSPARENCY_COPY as COPY } from '../../access/history-copy';
import { NoticesShell } from '../access-notices/notices-shell';

const TABS = [
  { to: '/access/history', label: COPY.whoAccessedTab },
  { to: '/access/certified-copies', label: COPY.copiesTab },
] as const;

/**
 * The declarant's transparency pages (spec 10 FE-4): Who accessed my declaration and Certified
 * copies, side by side as tabs under the page title, in the declarant's chrome.
 */
export function TransparencyFrame({
  title,
  active,
  children,
}: {
  title: string;
  active: (typeof TABS)[number]['to'];
  children: ReactNode;
}) {
  return (
    <NoticesShell>
      <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start gap-5 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
        <div className="grid gap-3">
          <Button asChild variant="ghost" size="sm" className="justify-self-start">
            <Link to="/">
              <Icon icon={ArrowLeft01Icon} />
              {COPY.home}
            </Link>
          </Button>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
            {title}
          </h1>
        </div>
        <nav aria-label={COPY.sections} className="flex gap-1 border-b border-border">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={tab.to === active ? 'page' : undefined}
              className={cn(
                focusRing,
                '-mb-px rounded-t-md border-b-2 px-3 py-2.5 text-[14.5px] font-medium whitespace-nowrap transition-colors',
                tab.to === active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {children}
      </main>
    </NoticesShell>
  );
}

/** A locked note under a list, with more in a tooltip: "Entries cannot be changed. (i)". */
export function FootNote({ text, tip, tipLabel }: { text: string; tip: string; tipLabel: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
      <Icon icon={SquareLock01Icon} className="size-3.5 shrink-0" />
      <span>{text}</span>
      <Tooltip content={tip}>
        <button
          type="button"
          aria-label={tipLabel}
          className={cn(
            focusRing,
            'grid size-6 place-items-center rounded-full hover:text-foreground',
          )}
        >
          <Icon icon={InformationCircleIcon} className="size-3.5" />
        </button>
      </Tooltip>
    </p>
  );
}
