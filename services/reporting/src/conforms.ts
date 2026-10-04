import type { z } from 'zod';

/**
 * `true` when every `T` the service answers with is accepted by the schema the contract documents
 * it with (`S`'s input, the form the export uses). One way only: a representation cannot outgrow
 * its documented schema, but the schema may still accept more than the service sends (a field
 * left optional, an enum value never used), which only the integration tests' contract checks
 * catch:
 *
 * @example
 * true satisfies Conforms<Officer, typeof officerSchema>;
 */
export type Conforms<T, S extends z.ZodType> = [T] extends [z.input<S>] ? true : false;
