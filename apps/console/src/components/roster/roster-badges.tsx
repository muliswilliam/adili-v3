import { Badge, cn, focusRing, Icon, Spinner, Tooltip } from '@adili/ui';
import {
  AlertCircleIcon,
  File02Icon,
  Flag02Icon,
  PlugSocketIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';

import type { RosterImport, RosterRecord, RosterRecordState } from '../../server/directory/client';
import { maskedNationalIdLabel, maskNationalId } from './national-id';
import { messages as m } from './messages';

/** Where an officer stands on the roster; the text carries the meaning, not the colour. */
export function RecordStateBadge({ state }: { state: RosterRecordState }) {
  if (state === 'onboarded') {
    return (
      <Badge variant="success">
        <Icon icon={Tick02Icon} strokeWidth={2.4} />
        {m.stateOnboarded}
      </Badge>
    );
  }
  if (state === 'exited') return <Badge variant="info">{m.stateExited}</Badge>;
  return <Badge>{m.stateNotOnboarded}</Badge>;
}

/** On the roster but missing from the latest complete import: the reporting officer reviews it. */
export function NotInLatestImportBadge() {
  return (
    <Badge variant="warning">
      <Icon icon={Flag02Icon} strokeWidth={2} />
      {m.notInLatestImport}
    </Badge>
  );
}

/** A national ID in a list: bullets on screen, "masked, ends in 1 2 3" for screen readers. */
export function MaskedNationalId({ value }: { value: string }) {
  return (
    <>
      <span aria-hidden="true" className="font-mono text-[13.5px] tracking-[0.02em]">
        {maskNationalId(value)}
      </span>
      <span className="sr-only">{maskedNationalIdLabel(value)}</span>
    </>
  );
}

/** How the rows came in: a file from the reporting officer, or a batch from the HR system. */
export function ImportChannelBadge({ channel }: { channel: RosterImport['channel'] }) {
  return channel === 'api' ? (
    <Badge variant="ai">
      <Icon icon={PlugSocketIcon} strokeWidth={2} />
      {m.channelApi}
    </Badge>
  ) : (
    <Badge>
      <Icon icon={File02Icon} strokeWidth={2} />
      {m.channelFile}
    </Badge>
  );
}

export function ImportStateBadge({ state }: { state: RosterImport['state'] }) {
  if (state === 'completed') {
    return (
      <Badge variant="success">
        <Icon icon={Tick02Icon} strokeWidth={2.4} />
        {m.importCompleted}
      </Badge>
    );
  }
  if (state === 'failed') {
    return (
      <Badge variant="destructive">
        <Icon icon={AlertCircleIcon} strokeWidth={2.2} />
        {m.importFailed}
      </Badge>
    );
  }
  return (
    <Badge variant="info">
      <Spinner className="size-[11px] border-[1.5px]" />
      {state === 'pending' ? m.importPending : m.importProcessing}
    </Badge>
  );
}

/** What an import did to a record. */
export function ImportOutcomeBadge({
  outcome,
}: {
  outcome: RosterRecord['imports'][number]['outcome'];
}) {
  if (outcome === 'created') return <Badge variant="success">{m.outcomeCreated}</Badge>;
  if (outcome === 'updated') return <Badge variant="info">{m.outcomeUpdated}</Badge>;
  if (outcome === 'rejected') {
    return (
      <Badge variant="destructive">
        <Icon icon={AlertCircleIcon} strokeWidth={2.2} />
        {m.outcomeRejected}
      </Badge>
    );
  }
  return <Badge>{m.outcomeUnchanged}</Badge>;
}

/** "Complete roster" or "Partial update", with what that means in a tooltip. */
export function CompletenessBadge({ declaredComplete }: { declaredComplete: boolean }) {
  return (
    <Tooltip content={declaredComplete ? m.completeRosterTip : m.partialUpdateTip} side="right">
      <Badge tabIndex={0} className={cn(focusRing, 'cursor-default')}>
        {declaredComplete ? m.completeRoster : m.partialUpdate}
      </Badge>
    </Tooltip>
  );
}
