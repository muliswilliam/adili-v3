import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon } from './icon';
import { Tooltip } from './tooltip';

export interface InfoTipProps {
  /** Names the button for assistive technology, e.g. "About section 1". */
  label: string;
  /** Supplementary text shown on hover and focus. */
  content: ReactNode;
  className?: string;
}

/**
 * A 20px (i) button beside a heading or label that shows `content` in a tooltip, e.g. the
 * provision a Form M section reports on. Muted until hovered. Never put what the user needs to
 * finish a task in it.
 */
export function InfoTip({ label, content, className }: InfoTipProps) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          focusRing,
          'inline-grid size-5 shrink-0 cursor-help place-items-center rounded-full align-[-4px] text-muted-foreground hover:bg-muted hover:text-foreground',
          className,
        )}
      >
        <Icon icon={InformationCircleIcon} className="size-[15px]" />
      </button>
    </Tooltip>
  );
}
