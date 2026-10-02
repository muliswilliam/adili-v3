import { PLATFORM_TENANT, TENANT_KEY } from '@adili/api-kit';
import { LAW_ENFORCEMENT_TENANT } from '@adili/roles';
import { z } from 'zod';

/**
 * Tenant keys that can never be a Commission's slug: the platform-wide RLS context, the tenant of
 * law enforcement accounts (their RLS context in the access service, so a Commission slugged
 * `lea` would share its rows with every officer), and `new`, which would collide with the
 * console's create route (`/commissions/new`).
 */
export const RESERVED_SLUGS: readonly string[] = [PLATFORM_TENANT, LAW_ENFORCEMENT_TENANT, 'new'];

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

export type OfficerCategoryCode = (typeof OFFICER_CATEGORY_CODES)[number];

/** `Slug` in the contract: the tenant key. */
export const slugSchema = z
  .string()
  .regex(TENANT_KEY, 'Use 2 to 20 lowercase letters or digits, starting with a letter')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), 'This key is reserved')
  .meta({
    description: `Tenant key. Lowercase letter followed by lowercase letters or digits, 2-20 chars. Upper-cased it is the issuer code in reference numbers. Reserved: ${RESERVED_SLUGS.map((slug) => `\`${slug}\``).join(', ')}.`,
    not: { enum: RESERVED_SLUGS },
    examples: ['psc', 'tsc', 'cpsb047', 'naeth'],
  });

export const commissionTypeSchema = z.enum(['hosted', 'federated']);

export const officerCategoryCodeSchema = z
  .enum(OFFICER_CATEGORY_CODES)
  .meta({ description: 'One paragraph of Act s.32 or Regs r.5' });

/** Body of `POST /v1/commissions` (`CreateCommission` in the contract). */
export const createCommissionBody = z.strictObject({
  slug: slugSchema,
  name: z
    .string()
    .trim()
    .min(3, 'Enter 3 to 120 characters')
    .max(120, 'Enter 3 to 120 characters')
    .meta({ examples: ['Teachers Service Commission'] }),
  type: commissionTypeSchema,
  categories: z
    .array(officerCategoryCodeSchema)
    .refine((codes) => new Set(codes).size === codes.length, 'Categories must not repeat')
    .meta({ uniqueItems: true }),
});

export type CreateCommissionBody = z.infer<typeof createCommissionBody>;
