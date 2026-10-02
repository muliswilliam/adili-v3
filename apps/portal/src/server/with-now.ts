/** A result with the server's clock, so day counts read the same on the server and in the browser. */
export type WithNow<T> = T & { now: string };

/** Awaits `result` and adds the server's clock to it. */
export async function withNow<T extends object>(result: Promise<T>): Promise<WithNow<T>> {
  return { ...(await result), now: new Date().toISOString() };
}
