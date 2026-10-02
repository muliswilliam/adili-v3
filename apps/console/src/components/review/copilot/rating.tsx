import { FeedbackControl } from '@adili/ui';

import type { CopilotAccess, CopilotBlock } from './copilot-view';
import type { CaseCopilot } from './use-case-copilot';

/**
 * The rating of one block of an output (a summary block, or one flag's explanation): the
 * reviewer holding the case rates it; a supervisor sees the rating; anyone else sees nothing.
 * One rating per reviewer per block of an output, as review.yaml has it (`CopilotBlock`).
 */
export function Rating({
  state,
  access,
  jobId,
  block,
  group,
}: {
  state: CaseCopilot;
  access: CopilotAccess;
  jobId: string | null;
  block: CopilotBlock;
  /** Names the control: "Rate the overview". */
  group: string;
}) {
  const value = state.ratingOf(jobId, block);
  if (access === 'viewer' || !jobId) return null;
  if (access === 'supervisor' && !value) return null;
  return (
    <FeedbackControl
      className="w-full"
      value={value}
      readOnly={access === 'supervisor'}
      messages={{ group }}
      onRate={(feedback) => state.rate(jobId, block, feedback)}
    />
  );
}
