import {
  Alert,
  AlertTitle,
  Button,
  CardIcon,
  cn,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Icon,
  useToast,
} from '@adili/ui';
import { AlertCircleIcon, Loading03Icon, PauseIcon, PlayIcon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type {
  IntegrationGatewayResult,
  IntegrationSystem,
  SystemCoverage,
} from '../../server/integration-gateway/client';
import { goToSignIn } from '../sign-in-redirect';
import { isInstructed, systemInfo } from './coverage';
import { messages as m } from './messages';

/** Pauses (`paused: true`) or resumes a system; the gateway's answer. */
export type SetPaused = (
  system: IntegrationSystem,
  paused: boolean,
) => Promise<IntegrationGatewayResult<SystemCoverage>>;

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

/**
 * What the pause dialog lists for a system: registries feed review cases, IPRS onboarding; an
 * instructed system's callers get "unavailable" (nothing is queued), and nothing of it is cached.
 */
function pauseEffects(row: SystemCoverage): string[] {
  const system = systemInfo(row.system);
  if (isInstructed(system)) {
    return [m.pauseNothingSent(system), m.pauseNothingQueued, system.retries, m.auditNote];
  }
  const effects =
    row.system === 'iprs'
      ? [m.pauseOnboarding]
      : [m.pauseCasesFlow(system), m.pauseRechecked(system)];
  return [m.pauseNothingSent(system), ...effects, m.pauseCached, m.auditNote];
}

/**
 * The Pause or Resume button of a system on the Integrations page (spec 07b FE-3, S13), with its
 * confirm dialog: "Pause {system}? Lookups will be marked unavailable until resumed." The dialog
 * stays open on failure so it can be tried again (a pause the gateway recorded but could not apply
 * is applied by the retry); on success a toast and `onChanged` (the page reads the coverage again).
 */
export function PauseControl({
  row,
  setPaused,
  onChanged,
}: {
  row: SystemCoverage;
  setPaused: SetPaused;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const system = systemInfo(row.system);
  const { name } = system;
  const pausing = !row.paused;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const outcome = await setPaused(row.system, pausing).catch(() => unavailable);
    setBusy(false);
    if (outcome.ok) {
      setOpen(false);
      toast({ title: pausing ? m.pausedToast(name) : m.resumedToast(name) });
      onChanged();
      return;
    }
    if (outcome.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    const forbidden = outcome.error.kind === 'problem' && outcome.error.problem.status === 403;
    setError(forbidden ? m.actionForbidden : pausing ? m.pauseFailed(name) : m.resumeFailed(name));
  };

  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant={pausing ? 'secondary' : 'default'}
          aria-label={pausing ? m.pauseLabel(name) : m.resumeLabel(name)}
          className="w-[104px]"
        >
          <Icon icon={pausing ? PauseIcon : PlayIcon} />
          {pausing ? m.pause : m.resume}
        </Button>
      </DialogTrigger>
      <DialogContent busy={busy}>
        <DialogHeader className="flex-row items-center gap-3">
          <CardIcon className={cn('mb-0', pausing && 'bg-warning-subtle text-warning')}>
            <Icon icon={pausing ? PauseIcon : PlayIcon} />
          </CardIcon>
          <DialogTitle>{pausing ? m.pauseTitle(name) : m.resumeTitle(name)}</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-3">
          {error ? (
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          ) : null}
          <DialogDescription asChild>
            <div className="grid gap-2 text-[15px] text-secondary-foreground">
              {pausing ? (
                <>
                  <p>
                    {isInstructed(system) ? m.pauseInstructionsText(system) : m.pauseText(system)}
                  </p>
                  <ul className="grid list-disc gap-1 pl-5 text-sm">
                    {pauseEffects(row).map((effect) => (
                      <li key={effect}>{effect}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p>
                    {isInstructed(system)
                      ? m.resumeInstructionsText(system, row.rateLimitPerMinute)
                      : m.resumeText(system, row.rateLimitPerMinute)}
                  </p>
                  {isInstructed(system) ? <p>{m.resumeNothingResent(system)}</p> : null}
                  <p className="text-sm text-muted-foreground">{m.auditNote}</p>
                </>
              )}
            </div>
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              {m.cancel}
            </Button>
          </DialogClose>
          <Button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? (
              <>
                <Icon icon={Loading03Icon} className="animate-spin motion-reduce:animate-none" />
                {pausing ? m.pausing : m.resuming}
              </>
            ) : (
              <>
                <Icon icon={pausing ? PauseIcon : PlayIcon} />
                {pausing ? m.pauseLabel(name) : m.resumeLabel(name)}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
