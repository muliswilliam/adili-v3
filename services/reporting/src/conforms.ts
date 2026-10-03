import type { z } from 'zod';

/**
 * `true` when every `T` the service answers with is accepted by the schema the contract documents
 * it with (`S`'s input, the form the export uses), so a representation and its documented schema
 * cannot drift apart:
 *
 * @example
 * true satisfies Conforms<Officer, typeof officerSchema>;
 */
export type Conforms<T, S extends z.ZodType> = [T] extends [z.input<S>] ? true : false;
