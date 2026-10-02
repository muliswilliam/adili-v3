import { useToast } from '@adili/ui';
import { useEffect, useMemo } from 'react';

import { getCaseCopilot, rateCopilotOutput, refreshCaseCopilot } from '../../../server/copilot';
import type { Copilot } from '../../../server/copilot.server';
import type { CaseDetail } from '../../../server/review/types';
import { type CopilotAccess, hasPreviousDeclaration } from './copilot-view';
import { CopilotLauncher, CopilotPanel, type CopilotPanelProps } from './copilot-panel';
import { highlightInDeclaration, type ResolvedRef, sourceRefResolver } from './source-refs';
import { type CopilotApi, useCaseCopilot } from './use-case-copilot';

/** The server functions, as the hook calls them. */
export const copilotApi: CopilotApi = {
  read: (caseId) => getCaseCopilot({ data: { caseId } }),
  refresh: (caseId) => refreshCaseCopilot({ data: { caseId } }),
  rate: (jobId, block, feedback) => rateCopilotOutput({ data: { jobId, block, ...feedback } }),
};

export interface CaseCopilotProps {
  caseId: string;
  /** The case as `GET /v1/review/cases/{caseId}` returns it: flags, document and versions. */
  detail: Pick<CaseDetail, 'flags' | 'document' | 'versions'>;
  /** `assignee` for the reviewer holding the case, `supervisor`, else `viewer`. */
  access: CopilotAccess;
  /** The name of the reviewer holding the case, whose ratings a supervisor reads. */
  assigneeName?: string;
  /** The panel is open; closed, the launcher bar shows its state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a flag's explanation (Explain on a flag card); pass a new `key` each time. */
  explain?: CopilotPanelProps['explain'];
  /**
   * Opens a source ref's target in the declaration pane. Defaults to scrolling to the element
   * with the ref's `declarationAnchorId` and highlighting it.
   */
  onOpenSource?: (resolved: ResolvedRef) => void;
  selection?: CopilotPanelProps['selection'];
  /** The copilot view from the route's loader, if it read one; else the panel reads it. */
  initial?: Copilot;
  /**
   * Told the copilot's status whenever it changes (null until first read), so the host can offer
   * Explain on its flag cards only once there are explanations.
   */
  onStatusChange?: (status: Copilot['status'] | null) => void;
  /** Fakes in tests. */
  api?: CopilotApi;
  /** "Now" for the relative times; tests fix it. Defaults to the time of each render. */
  now?: Date;
}

/**
 * The Copilot of a review case, ready to mount in the case view's side column (spec 07c FE-2):
 * the launcher bar while closed, the panel while open. It reads the copilot view itself and
 * keeps polling while the summary is being prepared, open or closed, so the launcher stays
 * current. Refresh failures are toasts; everything else is in the panel.
 */
export function CaseCopilot({
  caseId,
  detail,
  access,
  assigneeName,
  open,
  onOpenChange,
  explain,
  onOpenSource = (resolved) => {
    highlightInDeclaration(resolved.anchorId);
  },
  selection,
  initial,
  onStatusChange,
  api = copilotApi,
  now,
}: CaseCopilotProps) {
  const state = useCaseCopilot(caseId, api, initial);
  const status = state.copilot?.status ?? null;
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  const { toast } = useToast();
  const resolveRef = useMemo(() => sourceRefResolver(detail.document), [detail.document]);

  if (state.error === 'not-found') return null;
  if (!open) {
    return (
      <CopilotLauncher
        state={state}
        onOpen={() => {
          onOpenChange(true);
        }}
      />
    );
  }
  return (
    <CopilotPanel
      state={state}
      access={access}
      assigneeName={assigneeName}
      flags={detail.flags}
      versions={detail.versions}
      resolveRef={resolveRef}
      hasPrevious={hasPreviousDeclaration(detail.flags)}
      onClose={() => {
        onOpenChange(false);
      }}
      onRefresh={() => {
        void state.refresh().then((problem) => {
          if (problem) toast({ title: problem, urgency: 'assertive' });
        });
      }}
      onOpenSource={onOpenSource}
      selection={selection}
      explain={explain}
      now={now ?? new Date()}
    />
  );
}
