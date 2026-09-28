import { z } from 'zod';

/**
 * A Commission's slug as the console's server functions take it. Loose on purpose: a bounded
 * string, so a malformed one reaches the directory and reads as not found, like another
 * Commission's.
 */
export const commissionSlug = z.string().min(1).max(40);
