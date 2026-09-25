import { z } from 'zod';

const principalSchema = z.object({
  subject: z.string(),
  tenant: z.string().nullable(),
  roles: z.array(z.string()),
  clientId: z.string().nullable(),
});

export type Principal = z.infer<typeof principalSchema>;

export type PrincipalResult = { ok: true; principal: Principal } | { ok: false; reason: string };

/** Asks the directory service who the access token belongs to (`GET /v1/me`). */
export async function fetchPrincipal(
  baseUrl: string,
  accessToken: string,
): Promise<PrincipalResult> {
  try {
    const response = await fetch(new URL('/v1/me', baseUrl), {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return { ok: false, reason: `Directory service answered ${response.status}` };
    }
    return { ok: true, principal: principalSchema.parse(await response.json()) };
  } catch {
    return { ok: false, reason: 'Directory service is unreachable' };
  }
}
