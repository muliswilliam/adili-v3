import { useToast } from '@adili/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { CASE_COPY } from '../../review-case/messages';
import type { AssignmentAction, CaseViewer } from '../../review-case/case';
import { claimCase, getReviewers, reassignCase, releaseCase } from '../../server/review-case';
import type { Assignee, CaseListItem } from '../../server/review/types';
import type { ServiceError, ServiceResult } from '../../server/service-call';
import {
  ClaimDialog,
  ReassignDialog,
  ReleaseDialog,
  UnassignDialog,
} from './case/assignment-dialogs';

/** What a failed action says in its dialog (or a toast, for a reviewer's direct Claim). */
export function failureText(error: ServiceError): string {
  if (error.kind === 'unauthenticated') return CASE_COPY.sessionEnded;
  return CASE_COPY.actionFailed;
}

/** 403, 404 and 409 mean the page is out of date: reload it rather than retry. */
export function isStale(error: ServiceError): boolean {
  return error.kind === 'problem' && [403, 404, 409].includes(error.problem.status);
}

/** The case an assignment action is for. */
export interface AssignmentTarget {
  item: CaseListItem;
  /** The case's reviewers of record, to mark them in the reassign dialog; empty when unknown. */
  reviewerHistory: Assignee[];
}

export interface UseCaseAssignmentOptions {
  viewer: CaseViewer & { name: string };
  /** The viewer's Commission, for the reassign dialog's reviewers. */
  slug: string | null;
  /** Reloads the page's data (the router's loaders) after a change. */
  refresh: () => Promise<void>;
  /** The case as the page shows it now, to say who won a claim race once it has reloaded. */
  find: (caseId: string) => CaseListItem | undefined;
}

type Open = { action: Exclude<AssignmentAction, 'assign'>; target: AssignmentTarget } | null;

/**
 * The assignment actions on a case (spec 07a FE-2 and FE-3), shared by the case view's header and
 * the queue's rows: Claim (a supervisor confirms first, since they become a reviewer of record),
 * Release, Unassign, and Reassign or Assign with the Commission's reviewers. `start` runs one;
 * `dialogs` renders their dialogs once for the page. A change toasts, then reloads the page; a
 * claim another reviewer won reloads and says who holds the case now; a stale page (403, 404,
 * 409) reloads with a note.
 */
export function useCaseAssignment({ viewer, slug, refresh, find }: UseCaseAssignmentOptions): {
  start: (action: AssignmentAction, target: AssignmentTarget) => void;
  dialogs: ReactNode;
} {
  const { toast } = useToast();
  const [open, setOpen] = useState<Open>(null);
  // The last target stays while a dialog closes, so its words do not vanish mid-animation.
  const [shown, setShown] = useState<AssignmentTarget | null>(null);
  // A new object per lost claim, so a second race on the same case is told too.
  const [conflict, setConflict] = useState<{ caseId: string } | null>(null);
  const told = useRef<{ caseId: string } | null>(null);
  const winner = conflict ? (find(conflict.caseId)?.assignee ?? null) : null;

  // A claim that lost the race reloads, then says who holds the case once the page shows it.
  useEffect(() => {
    if (!conflict || !winner || told.current === conflict) return;
    told.current = conflict;
    toast({ title: CASE_COPY.claimConflict(winner.name), urgency: 'assertive' });
  }, [conflict, winner, toast]);

  const close = () => {
    setOpen(null);
  };

  /** Runs an assignment change; resolves to an error for the dialog, or null when done. */
  async function run(
    change: () => Promise<ServiceResult<unknown>>,
    success: string,
  ): Promise<string | null> {
    const result = await change();
    if (!result.ok) {
      if (!isStale(result.error)) return failureText(result.error);
      close();
      toast({ title: CASE_COPY.stale, urgency: 'assertive' });
      await refresh();
      return null;
    }
    close();
    toast({ title: success });
    await refresh();
    return null;
  }

  async function claim(item: CaseListItem): Promise<string | null> {
    const result = await claimCase({ data: { caseId: item.id } });
    if (!result.ok && result.error.kind === 'problem' && result.error.problem.status === 409) {
      close();
      setConflict({ caseId: item.id });
      await refresh();
      return null;
    }
    return run(() => Promise.resolve(result), CASE_COPY.claimed);
  }

  function start(action: AssignmentAction, target: AssignmentTarget) {
    setShown(target);
    if (action === 'claim' && !viewer.supervisor) {
      void claim(target.item).then((error) => {
        if (error) toast({ title: error, urgency: 'assertive' });
      });
      return;
    }
    // Assign is Reassign with nobody holding the case.
    setOpen({ action: action === 'assign' ? 'reassign' : action, target });
  }

  const target = open?.target ?? shown;
  const item = target?.item;
  const onOpenChange = (next: boolean) => {
    if (!next) close();
  };

  const dialogs = item ? (
    <>
      <ClaimDialog
        open={open?.action === 'claim'}
        onOpenChange={onOpenChange}
        reference={item.reference}
        name={item.declarantName}
        onConfirm={() => claim(item)}
      />
      <ReleaseDialog
        open={open?.action === 'release'}
        onOpenChange={onOpenChange}
        reference={item.reference}
        onConfirm={() => run(() => releaseCase({ data: { caseId: item.id } }), CASE_COPY.released)}
      />
      <UnassignDialog
        open={open?.action === 'unassign'}
        onOpenChange={onOpenChange}
        reference={item.reference}
        holder={item.assignee?.name ?? ''}
        onConfirm={() =>
          run(
            () => reassignCase({ data: { caseId: item.id, assignee: null } }),
            CASE_COPY.unassigned,
          )
        }
      />
      <ReassignDialog
        // A fresh dialog each time it opens: the reviewers reload and nobody is picked.
        key={open?.action === 'reassign' ? `reassign-${item.id}` : 'reassign-closed'}
        open={open?.action === 'reassign'}
        onOpenChange={onOpenChange}
        reference={item.reference}
        declarantName={item.declarantName}
        holder={item.assignee?.name ?? null}
        self={viewer.subject}
        loadReviewers={() =>
          slug
            ? getReviewers({
                data: {
                  slug,
                  assignee: item.assignee?.subject ?? null,
                  reviewerHistory: target.reviewerHistory,
                },
              })
            : Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } })
        }
        onConfirm={(reviewer) =>
          run(
            () => reassignCase({ data: { caseId: item.id, assignee: reviewer.subject } }),
            item.assignee ? CASE_COPY.reassigned(reviewer.name) : CASE_COPY.assigned(reviewer.name),
          )
        }
      />
    </>
  ) : null;

  return { start, dialogs };
}
