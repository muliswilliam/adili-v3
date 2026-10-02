import type { CommissionAiStatus } from '../../server/ai-status';
import type { ServiceResult } from '../../server/service-call';
import { messages as m } from './messages';
import { accessText, type ProviderAccess } from './model';
import { EnabledBadge } from './parts';

/** The provider class the status names, with the data classes it may process. */
export function statusAccess(status: CommissionAiStatus): ProviderAccess[] {
  const { providerClass } = status;
  if (!status.enabled || !providerClass) return [];
  return [{ providerClass, dataClasses: status.dataClasses }];
}

/**
 * The Commission's AI status line (spec 07c FE-4): "Enabled · External provider, synthetic data
 * only", or "Not enabled · No declaration data is sent to an AI provider". Read only.
 */
export function AiStatusValue({ status }: { status: ServiceResult<CommissionAiStatus> }) {
  if (!status.ok) {
    return <span className="font-normal text-muted-foreground">{m.aiStatusUnavailable}</span>;
  }
  const text = accessText(statusAccess(status.data));
  return (
    <span className="flex flex-wrap items-center gap-2">
      <EnabledBadge enabled={text !== null} />
      <span className="font-normal text-secondary-foreground">{text ?? m.aiNotEnabledText}</span>
    </span>
  );
}
