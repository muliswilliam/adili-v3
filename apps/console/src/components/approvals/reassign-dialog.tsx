import {
  Alert,
  AlertDescription,
  AssigneeAvatar,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  Icon,
  RadioCard,
  RadioGroup,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon, ArrowDataTransferHorizontalIcon } from '@hugeicons/core-free-icons';
import { useEffect, useId, useState } from 'react';

import type { ServiceResult } from '../../server/service-call';
import type { ApprovalKind, Assignee } from '../../server/review/types';
import { DialogFailure, DialogHeading, type FailureText } from '../dialog-parts';
import { messages as t } from './messages';

/** An approval to reassign, of any kind: what it is called and who proposed it. */
export interface ReassignTarget {
  kind: ApprovalKind;
  subjectId: string;
  /** "DCB-TSC-2026-0030559-8 · Esther Moraa Onyango". */
  subject: string;
  proposer: Assignee | null;
  /** Whom it is already reassigned to. */
  current: Assignee | null;
}

/**
 * Keyed by its target by the caller, so each opening starts with no list and nothing chosen.
 *
 * Reassign an approval to another supervisor (spec 08 FE-3, S14), for a supervisor who cannot or
 * should not decide it. The Commission's other supervisors are loaded when the dialog opens; the
 * proposer cannot be chosen. Informational for the service: whoever approves, the separation of
 * duties still applies.
 */
export function ReassignDialog({
  target,
  onOpenChange,
  loadSupervisors,
  onConfirm,
}: {
  target: ReassignTarget | null;
  onOpenChange: (open: boolean) => void;
  loadSupervisors: () => Promise<ServiceResult<Assignee[]>>;
  /** Resolves to a failure to show in the dialog, or null once reassigned (the dialog closes). */
  onConfirm: (target: ReassignTarget, to: Assignee) => Promise<FailureText | null>;
}) {
  const [supervisors, setSupervisors] = useState<Assignee[] | 'failed' | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureText | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadSupervisors()
      .then((result) => {
        if (live) setSupervisors(result.ok ? result.data : 'failed');
      })
      .catch(() => {
        if (live) setSupervisors('failed');
      });
    return () => {
      live = false;
    };
  }, [open, loadSupervisors]);

  const list = Array.isArray(supervisors) ? supervisors : [];

  async function submit(on: ReassignTarget) {
    setFailure(null);
    const to = list.find((each) => each.subject === chosen);
    if (!to) {
      setError(t.reassignDialog.pick);
      return;
    }
    setBusy(true);
    const failed = await onConfirm(on, to);
    setBusy(false);
    setFailure(failed);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setFailure(null);
        }
        onOpenChange(next);
      }}
    >
      {target ? (
        <DialogContent busy={busy} className="sm:max-w-[560px]">
          <DialogHeading
            icon={ArrowDataTransferHorizontalIcon}
            title={t.reassignDialog.title}
            description={target.subject}
          />
          <form
            noValidate
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(target);
            }}
          >
            <DialogBody className="gap-4">
              <DialogFailure failure={failure} />
              {supervisors === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  {t.reassignDialog.loading}
                </p>
              ) : supervisors === 'failed' ? (
                <Alert variant="destructive" role="alert">
                  <Icon icon={AlertCircleIcon} />
                  <AlertDescription>{t.reassignDialog.failed}</AlertDescription>
                </Alert>
              ) : list.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.reassignDialog.none}</p>
              ) : (
                <RadioGroup
                  legend={t.reassignDialog.legend}
                  legendHidden
                  hint={t.reassignDialog.hint}
                  error={error}
                >
                  {list.map((each) => {
                    const proposer = each.subject === target.proposer?.subject;
                    return (
                      <RadioCard
                        key={each.subject}
                        name={`${id}-supervisor`}
                        value={each.subject}
                        checked={chosen === each.subject}
                        disabled={busy || proposer}
                        icon={<AssigneeAvatar name={each.name} className="size-7 text-[11px]" />}
                        label={each.name}
                        description={
                          proposer ? t.reassignDialog.proposer : t.reassignDialog.supervisor
                        }
                        onChange={() => {
                          setChosen(each.subject);
                          setError(null);
                        }}
                      />
                    );
                  })}
                </RadioGroup>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t.reassignDialog.cancel}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={busy || !Array.isArray(supervisors) || list.length === 0}
              >
                {busy ? <Spinner /> : null}
                {t.reassignDialog.confirm}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
