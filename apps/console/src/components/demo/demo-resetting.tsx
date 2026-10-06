import { ProgressBar, Spinner } from '@adili/ui';
import { useEffect, useEffectEvent, useState } from 'react';

import { RESET_ESTIMATE_MS, type RestartPhase, timeLeft, waitForRestart } from './demo-restart';

const PHASES: Record<RestartPhase, string> = {
  stopping: 'Stopping the apps',
  restoring: 'Restoring the checkpoint and starting the apps again',
  back: 'Back. Opening the start page',
};

/**
 * What the presenter sees while the demo resets (#622): the whole console is covered, since every
 * app, this console too, stops and every sign-in ends. Counts down the usual time, watches the
 * console come back and then opens the start page, where the DEMO pill picks an account again.
 * The page is already loaded, so it rides out the outage without a request of its own failing.
 */
export function DemoResetting({
  checkpoint,
  restart = waitForRestart,
  navigate = (path) => {
    window.location.assign(path);
  },
}: {
  checkpoint: string;
  /** Resolves once the console is back; tests may stub it. */
  restart?: typeof waitForRestart;
  navigate?: (path: string) => void;
}) {
  const [phase, setPhase] = useState<RestartPhase>('stopping');
  const [elapsed, setElapsed] = useState(0);
  const start = useEffectEvent(() =>
    restart({ onPhase: setPhase }).then(() => {
      navigate('/');
    }),
  );

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    void start();
    return () => {
      clearInterval(timer);
    };
  }, []);

  const minutes = Math.round(RESET_ESTIMATE_MS / 60_000);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <section
        role="status"
        aria-labelledby="demo-resetting-title"
        className="w-full max-w-md rounded-xl border bg-background p-6 shadow-lg"
      >
        <h2 id="demo-resetting-title" className="flex items-center gap-2 text-lg font-semibold">
          <Spinner /> Resetting the demo to {checkpoint}
        </h2>
        <p className="mt-3 text-sm">
          Every app restarts on the restored stack, this console too, and everyone is signed out of
          the portal and the console. It is back in about {String(minutes)} minutes.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep this page open: it opens the start page by itself once the console answers. Then pick
          an account from the DEMO pill to act as.
        </p>
        <ProgressBar
          className="mt-5"
          label="Reset progress"
          value={phase === 'back' ? 100 : Math.min(95, (elapsed / RESET_ESTIMATE_MS) * 100)}
          showValue={false}
          announce={false}
          status={
            <span className="flex flex-col gap-0.5">
              <span>{PHASES[phase]}</span>
              {phase === 'back' ? null : (
                <span className="text-muted-foreground">{timeLeft(elapsed)}</span>
              )}
            </span>
          }
        />
      </section>
    </div>
  );
}
