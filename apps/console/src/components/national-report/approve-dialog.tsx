import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  IconTile,
  Spinner,
  useToast,
} from '@adili/ui';
import { AlertCircleIcon, Stamp01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import type { NationalReportResult } from '../../server/national-report.server';
import type { NationalReport } from '../../server/reporting/types';
import { messages as m } from './messages';
import { fyLabel } from './model';

export type ApproveReport = (
  fy: number,
  idempotencyKey: string,
) => Promise<NationalReportResult<NationalReport>>;

/**
 * "Approve the national report?": the consequences (NCR reference, the Restricted PDF under the
 * approver's name, no more edits) with the author and approver named. Mount it per opening: one
 * Idempotency-Key per opening, so a retry after a failure replays rather than approves twice. The service's refusal
 * of a supervisor who built or wrote part of it (`separation-of-duties`) is said in the dialog.
 */
export function ApproveDialog({
  open,
  onOpenChange,
  fy,
  author,
  approver,
  approve,
  onUnauthenticated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fy: number;
  author: string;
  approver: string;
  approve: ApproveReport;
  onUnauthenticated: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  // Mounted per opening (see the view), so each opening has its own key.
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await approve(fy, key);
    setBusy(false);
    if (result.ok) {
      onOpenChange(false);
      toast({ title: m.approvedToast(result.data.reference ?? '') });
      await router.invalidate();
      return;
    }
    const { error: failure } = result;
    if (failure.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    if (failure.kind === 'problem' && failure.problem.status === 409) {
      // Approved meanwhile: the page shows it.
      onOpenChange(false);
      await router.invalidate();
      return;
    }
    if (failure.kind === 'problem' && failure.problem.status === 403) {
      setError(
        failure.problem.code === 'separation-of-duties' ? m.separationOfDuties : m.approveForbidden,
      );
      return;
    }
    setError(m.approveFailed);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent busy={busy} aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={Stamp01Icon} />
          </IconTile>
          <DialogTitle>{m.approveTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {busy ? (
            <div role="status" className="flex flex-col items-center py-6 text-center">
              <Spinner className="mb-3.5 size-7" />
              <p className="text-[15px] font-semibold">{m.approving}</p>
              <p className="mt-1 text-sm text-muted-foreground">{m.approvingText}</p>
            </div>
          ) : (
            <>
              <p className="text-[14.5px] leading-[1.55]">{m.approveText(fyLabel(fy))}</p>
              <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted px-4 py-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{m.approveAuthor}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{author}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{m.approveApprover}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{approver}</dd>
                </div>
              </dl>
            </>
          )}
          {error ? (
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              change(false);
            }}
          >
            {m.cancel}
          </Button>
          <Button
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              void confirm();
            }}
          >
            {m.approve}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
