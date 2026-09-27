import {
  AlertCircleIcon,
  CloudSavingDone01Icon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { Icon } from './icon';
import { Spinner } from './spinner';

export type SaveStatus = 'saved' | 'saving' | 'retrying' | 'conflict';

const DEFAULT_MESSAGES: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  retrying: 'Could not save, retrying',
  conflict: 'Edited elsewhere: reload to continue',
};

export type SaveIndicatorProps = Omit<ComponentProps<'div'>, 'children'> & {
  status: SaveStatus;
  /** Replaces the default text for any status. */
  messages?: Partial<Record<SaveStatus, string>>;
  /** Shows a reload button next to the conflict message. */
  onReload?: () => void;
  /** Names the reload button. Defaults to "Reload". */
  reloadLabel?: string;
};

/**
 * Says whether the user's work is saved. Changes are announced politely, except a conflict
 * (the declaration was edited elsewhere), which is announced at once. Status is shown by text
 * and icon, never colour alone.
 */
export function SaveIndicator({
  status,
  messages,
  onReload,
  reloadLabel = 'Reload',
  className,
  ...props
}: SaveIndicatorProps) {
  const text = messages?.[status] ?? DEFAULT_MESSAGES[status];
  const conflict = status === 'conflict';

  return (
    <div
      data-status={status}
      className={cn(
        'inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span
        role="status"
        aria-live={conflict ? 'assertive' : 'polite'}
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap',
          status === 'retrying' && 'text-warning',
          conflict && 'font-medium text-destructive',
        )}
      >
        {status === 'saving' ? <Spinner className="size-3.5" /> : null}
        {status === 'saved' ? (
          <Icon icon={CloudSavingDone01Icon} className="size-[15px] text-success" />
        ) : null}
        {status === 'retrying' ? <Icon icon={WifiDisconnected01Icon} className="size-3.5" /> : null}
        {conflict ? <Icon icon={AlertCircleIcon} className="size-3.5" /> : null}
        {text}
      </span>
      {conflict && onReload ? (
        <Button type="button" variant="secondary" size="xs" onClick={onReload}>
          {reloadLabel}
        </Button>
      ) : null}
    </div>
  );
}
