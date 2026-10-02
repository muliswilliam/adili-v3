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
  /** Opens the composer, from the copilot's selection bar; leave out where there is no copilot. */
  onCompose?: () => void;
  /** The composer cannot open (e.g. `newClarificationBlock(...) !== null`). */
  composeDisabled?: boolean;
  server?: DraftServer;
}

export interface DraftWithAiWiring {
  /** The flags and items picked so far, shared by the copilot and the composer. */
  selection: DraftSelection;
  /** Spread onto `<CaseCopilot>`: its "Add to clarification" picks and its status. */
  copilot: {
    selection: NonNullable<CopilotPanelProps['selection']>;
    onStatusChange: (status: CopilotStatus | null) => void;
  };
  /** The composer's `tools` slot. */
  tools: (api: ComposerApi) => ReactNode;
}

/**
 * Wires Draft with AI (spec 07c FE-3) between a case's Copilot panel and its clarification
 * composer: one selection of flags (and items) both edit, cleared once a draft is inserted, and
 * whether AI is enabled for the Commission, from the copilot's status or a 409 `ai-not-enabled`
 * on drafting. The host keeps the composer's open state; mount it once per case view:
 *
 * ```tsx
 * const drafting = useDraftWithAi({ caseId, flags: detail.flags, onCompose, composeDisabled });
 * <CaseCopilot {...drafting.copilot} … />
 * <ClarificationComposer tools={drafting.tools} … />
 * ```
 */
export function useDraftWithAi({
  caseId,
  flags,
  onCompose,
  composeDisabled,
  server,
}: UseDraftWithAiOptions): DraftWithAiWiring {
  const [selection, setSelection] = useState<DraftSelection>(NO_SELECTION);
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus | null>(null);
  const [refused, setRefused] = useState(false);
  const enabled = copilotStatus !== 'not-enabled' && !refused;

  return {
    selection,
    copilot: {
      selection: {
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
      onStatusChange: setCopilotStatus,
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
