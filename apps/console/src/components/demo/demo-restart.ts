/**
 * Waiting out a demo reset (#621, #622) from the page that asked for it. The reset restarts every
 * app, this console too, so the page cannot ask the console how far it got: it watches the
 * console's `/health` go away and come back, then opens the start page.
 *
 * Only a `/health` that answers 200 with `status: up` counts as the console being up. On the
 * hosted demo Caddy answers 502 (or its own "restarting" page) while the console is down, so a
 * response alone says nothing; locally the request fails outright.
 */

/** How long a reset takes on the hosted demo, apps stopped to apps back (#622 cold run). */
export const RESET_ESTIMATE_MS = 4 * 60_000;
/** How long the page waits for the console to go down after asking for a reset. */
export const GOING_DOWN_MS = 45_000;
export const POLL_MS = 3000;

export type RestartPhase = 'stopping' | 'restoring' | 'back';

export interface RestartDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onPhase?: (phase: RestartPhase) => void;
}

const browserDeps: RestartDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Whether the console answers its health check now. */
export async function consoleIsUp(deps: Pick<RestartDeps, 'fetch' | 'now'>): Promise<boolean> {
  try {
    const response = await deps.fetch(`/health?t=${String(deps.now())}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown };
    return body.status === 'up';
  } catch {
    return false;
  }
}

/**
 * Resolves once the console has gone down for the restart (or after `GOING_DOWN_MS`, if it went
 * faster than a poll) and answers again.
 */
export async function waitForRestart(overrides: Partial<RestartDeps> = {}): Promise<void> {
  const deps = { ...browserDeps, ...overrides };
  deps.onPhase?.('stopping');
  const asked = deps.now();
  while (deps.now() - asked < GOING_DOWN_MS && (await consoleIsUp(deps))) {
    await deps.sleep(POLL_MS);
  }
  deps.onPhase?.('restoring');
  while (!(await consoleIsUp(deps))) await deps.sleep(POLL_MS);
  deps.onPhase?.('back');
}

/** "About 3 minutes left", "About 40 seconds left", or past the estimate, still waiting. */
export function timeLeft(elapsedMs: number, estimateMs = RESET_ESTIMATE_MS): string {
  const left = estimateMs - elapsedMs;
  if (left <= 0) return 'Taking a little longer than usual. Still waiting for the apps.';
  if (left < 60_000)
    return `About ${String(Math.max(10, Math.ceil(left / 10_000) * 10))} seconds left`;
  const minutes = Math.ceil(left / 60_000);
  return `About ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} left`;
}
