import { z } from 'zod';

/**
 * Response shapes of the roster API credential endpoints (spec #27). They are the contract: the
 * OpenAPI document is generated from them.
 */

/** The only scope an HR-system credential carries. */
export const ROSTER_WRITE_SCOPE = 'roster:write';

export const rosterApiCredentialSchema = z.object({
  clientId: z.string().meta({
    description: 'OAuth client id the HR system authenticates with',
    examples: ['roster-psc-3f9a2c1d'],
  }),
  createdAt: z.iso.datetime(),
  createdBy: z
    .object({
      id: z.string().meta({ description: "Creator's account (`sub`)" }),
      name: z
        .string()
        .nullable()
        .meta({
          description: 'Their display name when they created it; null when the token had none',
          examples: ['Fatuma Wanjiru'],
        }),
    })
    .meta({ description: 'The reporting officer who created the credential' }),
  rotatedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'Latest secret rotation; null if never rotated' }),
  revokedAt: z.iso.datetime().nullable().meta({
    description: 'When access was revoked; a revoked credential obtains no tokens',
  }),
  lastUsedAt: z.iso.datetime().nullable().meta({
    description:
      'Latest request made with one of its tokens (at most once a minute); null if never',
  }),
});
export type RosterApiCredential = z.infer<typeof rosterApiCredentialSchema>;

export const rosterApiCredentialWithSecretSchema = rosterApiCredentialSchema.extend({
  secret: z.string().meta({ description: 'Shown once; the platform does not store it' }),
  tokenEndpoint: z.url().meta({
    description: 'Where the HR system exchanges the client id and secret for a token',
    examples: ['https://auth.adili.go.ke/realms/adili/protocol/openid-connect/token'],
  }),
  scope: z.literal(ROSTER_WRITE_SCOPE),
});
export type RosterApiCredentialWithSecret = z.infer<typeof rosterApiCredentialWithSecretSchema>;
