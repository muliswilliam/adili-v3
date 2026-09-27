import { z } from 'zod';

import { PLATFORM_TENANT } from './access.js';

/**
 * Tenant keys that can never be a Commission's slug: the platform-wide RLS context, and `new`,
 * which would collide with the console's create route (`/commissions/new`).
 */
export const RESERVED_SLUGS: readonly string[] = [PLATFORM_TENANT, 'new'];

/** `OfficerCategoryCode` in the contract: one paragraph of Act s.32 or Regs r.5 (seeded list). */
export const OFFICER_CATEGORY_CODES = [
  'act-s32-2',
  'act-s32-3',
  'act-s32-4',
  'act-s32-5',
  'act-s32-6',
  'act-s32-7',
  'act-s32-8',
  'act-s32-9',
  'act-s32-10',
  'act-s32-11',
  'act-s32-12',
  'act-s32-13',
  'act-s32-14',
  'regs-r5-a',
  'regs-r5-b',
  'regs-r5-c',
  'regs-r5-d',
  'regs-r5-e',
  'regs-r5-f',
] as const;

/** Body of `POST /v1/commissions` (`CreateCommission` in the contract). */
export const createCommissionBody = z.strictObject({
  slug: z
    .string()
    .regex(
      /^[a-z][a-z0-9]{1,19}$/,
      'Use 2 to 20 lowercase letters or digits, starting with a letter',
    )
    .refine((slug) => !RESERVED_SLUGS.includes(slug), 'This key is reserved'),
  name: z.string().trim().min(3, 'Enter 3 to 120 characters').max(120, 'Enter 3 to 120 characters'),
  type: z.enum(['hosted', 'federated']),
  categories: z
    .array(z.enum(OFFICER_CATEGORY_CODES))
    .refine((codes) => new Set(codes).size === codes.length, 'Categories must not repeat'),
});

export type CreateCommissionBody = z.infer<typeof createCommissionBody>;
