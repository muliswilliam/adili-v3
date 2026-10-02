import { AI_PROVIDER_NAMES } from '@adili/ui';

import type { CommissionAiStatus } from '../../server/ai-status';
import type { ServiceResult } from '../../server/service-call';
import { messages as m } from './messages';
import { dataScopeText, type ProviderAccess } from './model';
import { EnabledBadge } from './parts';

/** The provider class the status names, with the data classes it may process; null when none. */
export function statusAccess(status: CommissionAiStatus): ProviderAccess | null {
  const { providerClass } = status;
  if (!status.enabled || !providerClass) return null;
  return { providerClass, dataClasses: status.dataClasses };
}

/**
 * The Commission's AI status line (spec 07c FE-4), as the spec words it: "AI assistance: enabled
 * (external provider, synthetic data only)", or "not enabled (no declaration data is sent to an
 * AI provider)". The Enabled or Not enabled badge stands for the first word and the detail follows
 * it as a sentence, naming the provider (story 15: "with which provider"): "External provider
 * Anthropic, synthetic data only". The row names "AI assistance"; this is its value. Read only.
 */
export function AiStatusValue({ status }: { status: ServiceResult<CommissionAiStatus> }) {
  if (!status.ok) {
    return <span className="font-normal text-muted-foreground">{m.aiStatusUnavailable}</span>;
  }
  const access = statusAccess(status.data);
  const { provider } = status.data;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <EnabledBadge enabled={access !== null} />
      <span className="font-normal text-secondary-foreground">
        {access
          ? m.statusEnabled(
              m.providerClass[access.providerClass],
              provider ? (AI_PROVIDER_NAMES[provider] ?? provider) : null,
              dataScopeText(access.dataClasses),
            )
          : m.aiNotEnabledText}
      </span>
    </span>
  );
}
