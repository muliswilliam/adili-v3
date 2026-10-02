import { Badge, cn, focusRing, Icon, Tooltip } from '@adili/ui';
import { InformationCircleIcon, Tick02Icon, UnavailableIcon } from '@hugeicons/core-free-icons';

import type { DataClass } from '../../server/ai-gateway/types';
import type { AiTenantRow } from '../../server/ai-policy.server';
import { messages as m } from './messages';
import { allowedProviders } from './model';

/** Small pieces the AI policy table, drawer and dialogs share. */

export function DataClassesTip() {
  return (
    <Tooltip content={m.dataClassesTip}>
      <button
        type="button"
        aria-label={m.dataClassesTipLabel}
        className={cn(
          'inline-grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground',
          focusRing,
        )}
      >
        <Icon icon={InformationCircleIcon} className="size-3.5" />
      </button>
    </Tooltip>
  );
}

/** The provider classes allowed for one data class ("External"), or "Blocked". */
export function GateCell({ row, dataClass }: { row: AiTenantRow; dataClass: DataClass }) {
  const allowed = allowedProviders(row.gate, dataClass);
  if (allowed.length === 0) {
    return <span className="text-[13.5px] text-muted-foreground">{m.blocked}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-success">
      <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.4} />
      {allowed.map((providerClass) => m.providerClass[providerClass]).join(', ')}
    </span>
  );
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="success">
      <Icon icon={Tick02Icon} strokeWidth={2.6} />
      {m.enabled}
    </Badge>
  ) : (
    <Badge>
      <Icon icon={UnavailableIcon} />
      {m.notEnabled}
    </Badge>
  );
}
