import { Tick02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';

export type SectionStatus = 'complete' | 'incomplete' | 'not-started';

export interface SectionNavSection {
  id: string;
  label: ReactNode;
  /** Completeness, shown in text under the label. Leave unset for a section without one, e.g. Summary. */
  status?: SectionStatus;
  /** Shown under the label before the status, e.g. "Check and submit". */
  hint?: ReactNode;
  /** Sub-sections listed under this one, e.g. one per person. */
  sections?: SectionNavSection[];
  /** Replaces the number in the marker, e.g. an icon for Summary. */
  marker?: ReactNode;
}

const DEFAULT_STATUS_LABELS: Record<SectionStatus, string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
  'not-started': 'Not started',
};

export type SectionNavProps = Omit<ComponentProps<'nav'>, 'children' | 'onSelect'> & {
  /** Names the navigation landmark, e.g. "Declaration sections". */
  label: string;
  /** In schedule order. */
  sections: SectionNavSection[];
  /** Id of the section or sub-section the user is on. */
  current: string;
  onSelect: (id: string) => void;
  /** Replaces the default status words. */
  statusLabels?: Partial<Record<SectionStatus, string>>;
  /** Shown under the list, e.g. a SaveIndicator and the due date. */
  footer?: ReactNode;
};

/**
 * The sections of a long form in order, each with its completeness in text. The section (or
 * sub-section) the user is on carries aria-current="page"; a parent of the current
 * sub-section is highlighted too. Every section is a button, so users can move freely.
 */
export function SectionNav({
  label,
  sections,
  current,
  onSelect,
  statusLabels,
  footer,
  className,
  ...props
}: SectionNavProps) {
  const words = { ...DEFAULT_STATUS_LABELS, ...statusLabels };

  return (
    <nav aria-label={label} className={cn('grid gap-4', className)} {...props}>
      <ol className="grid gap-0.5">
        {sections.map((section, index) => {
          const isCurrent = section.id === current;
          const holdsCurrent =
            isCurrent || (section.sections?.some((sub) => sub.id === current) ?? false);
          const detail = [section.hint, section.status ? words[section.status] : null].filter(
            (part) => part !== null && part !== undefined && part !== '',
          );

          return (
            <li key={section.id} data-status={section.status}>
              <button
                type="button"
                aria-current={isCurrent ? 'page' : undefined}
                onClick={() => {
                  onSelect(section.id);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-secondary-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring',
                  holdsCurrent && 'bg-card text-foreground shadow-card hover:bg-card',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold tabular-nums',
                    holdsCurrent
                      ? 'bg-primary text-primary-foreground'
                      : section.status === 'complete'
                        ? 'bg-success-subtle text-success'
                        : section.status === 'incomplete'
                          ? 'text-warning inset-ring-[1.5px] inset-ring-warning/60'
                          : 'text-muted-foreground inset-ring-[1.5px] inset-ring-input',
                  )}
                >
                  {section.status === 'complete' && !holdsCurrent ? (
                    <Icon icon={Tick02Icon} strokeWidth={3} className="size-3" />
                  ) : (
                    (section.marker ?? index + 1)
                  )}
                </span>
                <span className="min-w-0 flex-1 leading-[1.3]">
                  {section.label}
                  {detail.length > 0 ? <span className="sr-only">, </span> : null}
                  {detail.length > 0 ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {detail.map((part, partIndex) => (
                        <span key={partIndex}>
                          {partIndex > 0 ? ' · ' : null}
                          {part}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
              {section.sections && section.sections.length > 0 ? (
                <ol className="mt-2 mb-2.5 ml-[22px] grid gap-1 border-l-[1.5px] border-border py-0.5 pl-3">
                  {section.sections.map((sub) => {
                    const subCurrent = sub.id === current;
                    return (
                      <li key={sub.id} data-status={sub.status}>
                        <button
                          type="button"
                          aria-current={subCurrent ? 'page' : undefined}
                          onClick={() => {
                            onSelect(sub.id);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] text-secondary-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring',
                            subCurrent &&
                              'bg-card font-medium text-foreground shadow-card hover:bg-card',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'grid size-4 shrink-0 place-items-center rounded-full',
                              sub.status === 'complete'
                                ? 'bg-success-subtle text-success'
                                : sub.status === 'incomplete'
                                  ? 'inset-ring-[1.5px] inset-ring-warning/60'
                                  : 'inset-ring-[1.5px] inset-ring-input',
                            )}
                          >
                            {sub.status === 'complete' ? (
                              <Icon icon={Tick02Icon} strokeWidth={3} className="size-2.5" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{sub.label}</span>
                          {sub.status ? (
                            <span className="sr-only">, {words[sub.status]}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
      {footer ? (
        <div className="grid gap-2 border-t border-border pt-4 text-[13px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </nav>
  );
}
