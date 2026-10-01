/**
 * Compile-time checks that an app's generated contract types and a shared table agree, e.g.
 * `type Checked = Assert<Same<ContractStatus, SharedStatus>>` fails to compile once they drift.
 */

/** True when A and B are the same union. */
export type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compiles only for `true`. */
export type Assert<T extends true> = T;
