import {
  AlertCircleIcon,
  MinusSignIcon,
  RefreshIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Button } from './button';
import { Icon } from './icon';
import { Spinner } from './spinner';

/**
 * Where one registry's check stands. `found` has suggestions to review, `nothing-found` answered
 * with none, `unavailable` did not answer (it can be retried), `not-checked` was never asked.
 */
export type RegistryStatus = 'not-checked' | 'checking' | 'found' | 'nothing-found' | 'unavailable';

export interface RegistryStatusMessages {
  'not-checked': string;
  checking: string;
  /** Defaults to "1 suggestion" / "{n} suggestions". */
  found: (count: number) => string;
  'nothing-found': string;
  unavailable: string;
  retry: string;
  /** Names the retry button after its registry. Defaults to "Retry {registry}". */
  retryLabel: (registry: string) => string;
}

const DEFAULT_MESSAGES: RegistryStatusMessages = {
  'not-checked': 'Not checked',
  checking: 'Checking…',
  found: (count) => (count === 1 ? '1 suggestion' : `${String(count)} suggestions`),
  'nothing-found': 'Nothing found',
  unavailable: 'Not available now',
  retry: 'Retry',
  retryLabel: (registry) => `Retry ${registry}`,
};

export type RegistryStatusRowProps = Omit<ComponentProps<'li'>, 'children'> & {
  /** The registry's name, e.g. "NTSA". Not translated. */
  name: string;
  status: RegistryStatus;
  /** Number of suggestions, shown when `found`. */
  count?: number;
  /** Asks the registry again. Shown as a button when `unavailable`. */
  onRetry?: () => void;
  /** Replaces any of the default copy. */
  messages?: Partial<RegistryStatusMessages>;
  disabled?: boolean;
};

/**
 * One registry in the check: its name, then its status in text with an icon (spinner, tick,
 * dash or alert), never colour alone. An unavailable registry offers "Retry", named after it
 * ("Retry NTSA"). Renders an `<li>`, so put it in a RegistryStatusList.
 */
export function RegistryStatusRow({
  name,
  status,
  count = 0,
  onRetry,
  messages: overrides,
  disabled = false,
  className,
  ...props
}: RegistryStatusRowProps) {
  const messages = { ...DEFAULT_MESSAGES, ...overrides };
  const text = status === 'found' ? messages.found(count) : messages[status];

  return (
    <li
      data-status={status}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-xl bg-card px-3.5 py-2 shadow-card',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground',
          status === 'found' && 'font-medium text-success',
          status === 'unavailable' && 'font-medium text-warning',
        )}
      >
        {status === 'checking' ? <Spinner className="size-3.5" /> : null}
        {status === 'found' ? (
          <Icon icon={Tick02Icon} strokeWidth={2.4} className="size-3.5" />
        ) : null}
        {status === 'unavailable' ? <Icon icon={AlertCircleIcon} className="size-3.5" /> : null}
        {status === 'not-checked' || status === 'nothing-found' ? (
          <Icon icon={MinusSignIcon} strokeWidth={2.2} className="size-3.5" />
        ) : null}
        {text}
      </span>
      {status === 'unavailable' && onRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          aria-label={messages.retryLabel(name)}
          onClick={onRetry}
        >
          <Icon icon={RefreshIcon} />
          {messages.retry}
        </Button>
      ) : null}
    </li>
  );
}

export interface RegistryStatusEntry {
  /** A stable key, e.g. "ntsa". */
  id: string;
  name: string;
  status: RegistryStatus;
  count?: number;
}

export type RegistryStatusListProps = Omit<ComponentProps<'ul'>, 'children'> & {
  /** Names the list. Defaults to "Registry status". */
  label?: string;
  registries: RegistryStatusEntry[];
  /** Asks one registry again; its row shows a retry button while unavailable. */
  onRetry?: (id: string) => void;
  messages?: Partial<RegistryStatusMessages>;
  disabled?: boolean;
};

/**
 * The status strip of a registry check: a list with one RegistryStatusRow per registry, one
 * column on phones and two from `sm`. Each status is in text, so the list reads in full to
 * screen readers.
 */
export function RegistryStatusList({
  label = 'Registry status',
  registries,
  onRetry,
  messages,
  disabled,
  className,
  ...props
}: RegistryStatusListProps) {
  return (
    <ul aria-label={label} className={cn('grid gap-2 sm:grid-cols-2', className)} {...props}>
      {registries.map((registry) => (
        <RegistryStatusRow
          key={registry.id}
          name={registry.name}
          status={registry.status}
          count={registry.count}
          messages={messages}
          disabled={disabled}
          onRetry={
            onRetry
              ? () => {
                  onRetry(registry.id);
                }
              : undefined
          }
        />
      ))}
    </ul>
  );
}
