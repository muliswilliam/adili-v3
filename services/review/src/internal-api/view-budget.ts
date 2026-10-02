/**
 * How long a reviewer's read may wait on another service before review answers without it
 * (ADR-013 §2). Each budget covers the whole call: the service token, the attempt and the retry
 * after a 401, which the per-attempt timeouts of the service clients do not bound together. The
 * console waits 15 seconds for review (`apps/console/src/server/review/client.server.ts`), so
 * review always answers first: the case without its declaration, or the Registry tab's 502 with
 * the case's own statuses, rather than the console giving up on the whole page.
 */

/** The declaration of the version under review, for the case view and the Registry tab. */
export const VIEW_DECLARATIONS_BUDGET_MS = 5_000;

/** The registry records the Registry tab reads from the integration-gateway, all together. */
export const VIEW_REGISTRY_RECORDS_BUDGET_MS = 3_000;

/** The slowest a reviewer's read can be: the Registry tab reads the declaration, then the records. */
export const SLOWEST_VIEW_MS = VIEW_DECLARATIONS_BUDGET_MS + VIEW_REGISTRY_RECORDS_BUDGET_MS;

/**
 * `work`, or `unanswered()` thrown once `ms` have passed without its answer. The work itself is
 * left to finish or time out on its own; its outcome is then ignored.
 */
export async function within<T>(
  ms: number,
  work: () => Promise<T>,
  unanswered: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(unanswered());
    }, ms);
  });
  const running = work();
  // A late failure after the deadline must not surface as an unhandled rejection.
  running.catch(() => undefined);
  try {
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
