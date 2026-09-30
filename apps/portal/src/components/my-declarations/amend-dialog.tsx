import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Icon,
  IconTile,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon, PencilEdit02Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import { amendMyDeclaration } from '../../server/declarations';
import { signInAgain } from '../sign-in';
import { MY_DECLARATIONS_COPY as COPY } from './copy';

type Problem = 'amendment-window-closed' | 'not-submitted' | 'unavailable';

export interface AmendButtonProps {
  declarationId: string;
  /** The version in force, which the amendment starts from. */
  version: number;
  dueDate: string;
  /** Names the declaration for screen readers, e.g. "Initial declaration". */
  srContext?: string;
}

/**
 * "Amend" and its confirmation (spec 06 FE-4, S7): reopens the version in force as an
 * amendment and opens it in the workspace, where the banner says what is being amended.
 */
export function AmendButton({ declarationId, version, dueDate, srContext }: AmendButtonProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function amend() {
    setBusy(true);
    setProblem(null);
    const result = await amendMyDeclaration({ data: { declarationId } }).catch(
      () => ({ status: 'unavailable' }) as const,
    );
    if (result.status === 'amending') {
      await navigate({ to: '/declarations/$id', params: { id: declarationId } });
      return;
    }
    if (result.status === 'unauthenticated') {
      signInAgain();
      return;
    }
    setBusy(false);
    setProblem(
      result.status === 'conflict'
        ? result.code
        : result.status === 'not-found'
          ? 'not-submitted'
          : 'unavailable',
    );
  }

  const message =
    problem === 'amendment-window-closed'
      ? COPY.amendClosed(dueDate)
      : problem === 'not-submitted'
        ? COPY.amendNotSubmitted
        : problem === 'unavailable'
          ? COPY.amendFailed
          : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProblem(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={srContext ? `${COPY.amend} ${srContext}` : undefined}
        >
          <Icon icon={PencilEdit02Icon} />
          {COPY.amend}
        </Button>
      </DialogTrigger>
      <DialogContent busy={busy}>
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile>
            <Icon icon={PencilEdit02Icon} />
          </IconTile>
          <DialogTitle>{COPY.amendTitle(version)}</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-3">
          <DialogDescription className="text-[15px] text-foreground">
            {COPY.amendBody}
          </DialogDescription>
          <p className="text-[13px] text-muted-foreground">{COPY.amendNote(dueDate)}</p>
          {message ? (
            <Alert variant={problem === 'unavailable' ? 'destructive' : 'warning'}>
              <Icon icon={AlertCircleIcon} />
              <AlertDescription className="grid justify-items-start gap-2">
                <p>{message}</p>
                {problem === 'not-submitted' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setOpen(false);
                      void router.invalidate();
                    }}
                  >
                    <Icon icon={RefreshIcon} />
                    {COPY.reload}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
            }}
          >
            {COPY.amendCancel}
          </Button>
          <Button
            type="button"
            disabled={busy || (problem !== null && problem !== 'unavailable')}
            onClick={() => void amend()}
          >
            {busy ? <Spinner /> : null}
            {COPY.amendConfirm(version)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
