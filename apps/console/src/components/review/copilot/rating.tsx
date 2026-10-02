import { AiLabel, FeedbackControl } from '@adili/ui';

import type { CopilotAiLabel } from '../../../server/copilot.server';
import { type CopilotAccess } from './copilot-view';
import { labelDetails } from './panel-parts';
import { messages as t } from './messages';
import type { CaseCopilot } from './use-case-copilot';

/**
 * The rating of one output (a job): the reviewer holding the case rates it; a supervisor sees
 * the rating; anyone else sees nothing. One rating per reviewer per output, as review.yaml has it.
 */
export function Rating({
  state,
  access,
  jobId,
  label,
  group,
}: {
  state: CaseCopilot;
  access: CopilotAccess;
  jobId: string | null;
  label: CopilotAiLabel;
  group: string;
}) {
  const value = state.ratingOf(jobId);
  if (access === 'viewer' || !jobId) return null;
  if (access === 'supervisor' && !value) return null;
  return (
    <div className="relative border-t pt-3">
      <div className="pointer-events-none absolute top-3 left-0 flex h-7 items-center gap-2">
        <AiLabel
          size="sm"
          text={t.labelShort}
          details={labelDetails(label)}
          className="pointer-events-auto"
        />
        {access === 'assignee' ? (
          <span className="text-[13px] text-muted-foreground">{group}</span>
        ) : null}
      </div>
      <FeedbackControl
        className={access === 'supervisor' ? 'flex h-7 justify-end' : 'w-full'}
        value={value}
        readOnly={access === 'supervisor'}
        messages={{ group }}
        onRate={(feedback) => state.rate(jobId, feedback)}
      />
    </div>
  );
}
