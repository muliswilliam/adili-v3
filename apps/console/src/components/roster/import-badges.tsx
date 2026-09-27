import { Badge, Icon, Spinner, Tooltip } from '@adili/ui';
import {
  AlertCircleIcon,
  File02Icon,
  PlugSocketIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';

import type { RosterImport } from '../../server/directory/client';
import { importRunning } from './import-report';
import { messages as m } from './messages';

/** Processing, Completed or Failed; the icon and text carry the meaning, not the colour. */
export function ImportStateBadge({ state }: { state: RosterImport['state'] }) {
  if (importRunning({ state })) {
    return (
      <Badge variant="info">
        <Spinner className="size-[11px] border-[1.5px]" />
        {m.stateProcessing}
      </Badge>
    );
  }
  return state === 'completed' ? (
    <Badge variant="success">
      <Icon icon={Tick02Icon} strokeWidth={2.4} />
      {m.stateCompleted}
    </Badge>
  ) : (
    <Badge variant="destructive">
      <Icon icon={AlertCircleIcon} />
      {m.stateFailed}
    </Badge>
  );
}

/** How the rows came in: a file from the console, or a batch from the HR system. */
export function ChannelBadge({ channel }: { channel: RosterImport['channel'] }) {
  return channel === 'api' ? (
    <Badge variant="ai">
      <Icon icon={PlugSocketIcon} />
      {m.channelApi}
    </Badge>
  ) : (
    <Badge>
      <Icon icon={File02Icon} />
      {m.channelFile}
    </Badge>
  );
}

/** "Complete roster" or "Partial update", with what that means in a tooltip. */
export function CompletenessBadge({ declaredComplete }: { declaredComplete: boolean }) {
  return (
    <Tooltip content={declaredComplete ? m.completeRosterTip : m.partialUpdateTip} side="right">
      <Badge
        tabIndex={0}
        className="cursor-default outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {declaredComplete ? m.completeRoster : m.partialUpdate}
      </Badge>
    </Tooltip>
  );
}
