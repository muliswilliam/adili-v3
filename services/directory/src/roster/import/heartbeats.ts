/** How often a long activity heartbeats while it works, well inside its heartbeat timeout. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** Where heartbeats go: the activity's Temporal context. */
export interface Heartbeats {
  heartbeat(details?: unknown): void;
}

/**
 * Runs `work`, heartbeating at once and then every `intervalMs` until it settles, with the latest
 * progress `work` reported. Heartbeats prove the worker is alive through every phase (downloads,
 * buffering, parsing, long statements), not only when progress is made, so Temporal does not
 * take a slow attempt for a lost one and start another alongside it.
 */
export async function keepHeartbeating<T>(
  heartbeats: Heartbeats,
  work: (progress: (details: unknown) => void) => Promise<T>,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): Promise<T> {
  let latest: unknown;
  heartbeats.heartbeat(latest);
  const timer = setInterval(() => {
    heartbeats.heartbeat(latest);
  }, intervalMs);
  try {
    return await work((details) => {
      latest = details;
      heartbeats.heartbeat(details);
    });
  } finally {
    clearInterval(timer);
  }
}
