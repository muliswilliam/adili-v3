/**
 * The "refs resolve" check (spec 07c S9): every source ref in an output points at something in the
 * input, and its parts agree with each other, so the console's links land on the right item. A
 * real item id paired with the wrong person is as broken as an invented one.
 *
 * The same rules the gateway applies to every job's output (src/policy/source-refs.ts), so the
 * evals score what production would reject; the scorers apply them per field, which is stricter.
 */
import { documentRefProblem, type SourceRef, sameTarget } from '../../src/policy/source-refs.js';

export type { SourceRef };

/**
 * Why `ref` does not resolve against the declaration documents (current, previous; null for
 * none), or null when it does.
 */
export function refProblem(ref: SourceRef, documents: readonly unknown[]): string | null {
  return documentRefProblem(ref, documents);
}

/**
 * Whether `ref` is one of the input's refs (tasks given refs rather than documents): the same
 * section, person and item, and the same field path or none.
 */
export function refsAmong(ref: SourceRef, allowed: readonly SourceRef[]): boolean {
  return allowed.some((each) => sameTarget(ref, each));
}
