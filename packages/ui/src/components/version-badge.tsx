import { File01Icon } from '@hugeicons/core-free-icons';

import { Badge, type BadgeProps } from './badge';
import { Icon } from './icon';

/** `current`: the version in force. `superseded`: a newer version replaced it. */
export type VersionState = 'current' | 'superseded';

export interface VersionBadgeMessages {
  version: (version: number) => string;
  current: string;
  superseded: string;
}

export const VERSION_BADGE_MESSAGES: VersionBadgeMessages = {
  version: (version) => `Version ${String(version)}`,
  current: 'current',
  superseded: 'superseded',
};

const VARIANT = { current: 'success', superseded: 'warning' } as const;

export type VersionBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  /** The version number, 1 for the first submission. */
  version: number;
  /** Adds whether the version is in force; without it the badge only names the version. */
  state?: VersionState;
  messages?: Partial<VersionBadgeMessages>;
};

/**
 * A declaration or document version: "Version 2" (`info`), "Version 2 · current" (`success`) or
 * "Version 1 · superseded" (`warning`). The state is in the text, never colour alone.
 */
export function VersionBadge({ version, state, messages, ...props }: VersionBadgeProps) {
  const copy = { ...VERSION_BADGE_MESSAGES, ...messages };
  return (
    <Badge variant={state ? VARIANT[state] : 'info'} data-state={state} {...props}>
      <Icon icon={File01Icon} />
      {copy.version(version)}
      {state ? ` · ${copy[state]}` : null}
    </Badge>
  );
}
