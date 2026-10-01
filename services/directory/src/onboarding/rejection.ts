/**
 * A step's refusal that must not undo what the step wrote: e.g. a wrong code's attempt count, a
 * no-match's failure count, or ending a session whose time ran out. Return `reject(error)` from
 * the transaction's work instead of throwing; `unwrap` throws it once the transaction committed.
 *
 * @example
 * const result = await withTenant(db, context, async (tx) => {
 *   await countFailure(tx);
 *   return reject(ProblemException.fromCode('no-match'));
 * });
 * return unwrap(result);
 */
export class Rejection {
  constructor(readonly error: Error) {}
}

export function reject(error: Error): Rejection {
  return new Rejection(error);
}

export function unwrap<T>(result: T | Rejection): T {
  if (result instanceof Rejection) throw result.error;
  return result;
}
