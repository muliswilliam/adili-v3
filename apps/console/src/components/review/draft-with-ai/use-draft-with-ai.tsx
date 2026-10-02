import { type ReactNode, useState } from 'react';

import {
  type DraftFlag,
  type DraftSelection,
  NO_SELECTION,
  toggleFlag,
} from '../../../clarification/draft-selection';
import type { CopilotStatus } from '../../../server/review/types';
import type { ComposerApi } from '../composer/clarification-composer';
import type { CopilotPanelProps } from '../copilot/copilot-panel';
import { DraftWithAi, type DraftServer } from './draft-with-ai';

export interface UseDraftWithAiOptions {
  caseId: string;
  /** The case's flags (`CaseDetail.flags`). */
  flags: readonly DraftFlag[];
  /** The copilot's status where there is one (`CaseCopilot onStatusChange`): `not-enabled` disables it. */
  copilotStatus?: CopilotStatus | null;
  /** Opens the composer, from the copilot's selection bar; leave out where there is no copilot. */
  onCompose?: () => void;
  /** The composer cannot open (e.g. `newClarificationBlock(...) !== null`). */
  composeDisabled?: boolean;
  server?: DraftServer;
}

export interface DraftWithAiWiring {
  /** The flags and items picked so far, shared by the copilot and the composer. */
  selection: DraftSelection;
  /** `<CaseCopilot selection>`: its "Add to clarification" picks and selection bar. */
  copilotSelection: NonNullable<CopilotPanelProps['selection']>;
  /** Drops the picks, e.g. once a clarification is issued. */
  clear: () => void;
  /** The composer's `tools` slot. */
  tools: (api: ComposerApi) => ReactNode;
}

/**
 * Wires Draft with AI (spec 07c FE-3) between a case's Copilot panel and its clarification
 * composer: one selection of flags (and items) both edit, cleared once a draft is inserted, and
 * whether AI is enabled for the Commission, from the copilot's status or a 409 `ai-not-enabled`
 * on drafting. As the prototype has it, the copilot's picks open the composer as Draft with AI's
 * chips, not as items. The host keeps the composer's open state; mount it once per case:
 *
 * ```tsx
 * const drafting = useDraftWithAi({ caseId, flags, copilotStatus, onCompose, composeDisabled });
 * <CaseCopilot selection={drafting.copilotSelection} onStatusChange={setCopilotStatus} … />
 * <ClarificationComposer tools={drafting.tools} … />
 * ```
 */
export function useDraftWithAi({
  caseId,
  flags,
  copilotStatus = null,
  onCompose,
  composeDisabled,
  server,
}: UseDraftWithAiOptions): DraftWithAiWiring {
  const [selection, setSelection] = useState<DraftSelection>(NO_SELECTION);
  const [refused, setRefused] = useState(false);
  // A refusal holds until the copilot's status moves on (a refresh asked the gateway again, e.g.
  // after an admin enabled AI for the Commission): from then it is the copilot that says.
  const [seenStatus, setSeenStatus] = useState(copilotStatus);
  if (seenStatus !== copilotStatus) {
    setSeenStatus(copilotStatus);
    if (copilotStatus !== 'not-enabled') setRefused(false);
  }
  const enabled = copilotStatus !== 'not-enabled' && !refused;

  return {
    selection,
    copilotSelection: {
      flagIds: [...selection.flagIds],
      onToggle: (flagId) => {
        setSelection((current) => toggleFlag(current, flagId));
      },
      onClear: () => {
        setSelection(NO_SELECTION);
      },
      onCompose,
      composeDisabled,
    },
    clear: () => {
      setSelection(NO_SELECTION);
    },
    tools: (api) => (
      <DraftWithAi
        api={api}
        caseId={caseId}
        flags={flags}
        selection={selection}
        onSelectionChange={setSelection}
        enabled={enabled}
        onNotEnabled={() => {
          setRefused(true);
        }}
        server={server}
      />
    ),
  };
}
