/**
 * Step-up for a legal act (spec 06), shared by the BFF that asks Keycloak for it and the services
 * that check it on `Principal.acr` and `Principal.authTime`. Framework-free, so the apps' servers
 * import it too (`@adili/api-kit/client`).
 */

/**
 * The ACR of a token issued right after a fresh one-time code: the realm's `acr.loa.map` names
 * level 2 (the code) `step-up`.
 */
export const STEP_UP_ACR = 'step-up';

/**
 * How long after the code a service accepts a step-up for a legal act such as submission:
 * `auth_time` at most this old (spec 06: five minutes). The realm's max age for the code is
 * shorter (180 s, `STEP_UP_CODE_MAX_AGE_SECONDS` in bff-auth), so a step-up Keycloak answers
 * silently with the old `auth_time` still leaves time to affirm and submit.
 */
export const STEP_UP_WINDOW_SECONDS = 300;

/**
 * How far ahead of the checking service's clock an `auth_time` may be and still count: the skew
 * between Keycloak's clock and the service's. Further ahead, the token is not trusted as fresh.
 */
export const STEP_UP_CLOCK_SKEW_SECONDS = 60;

/**
 * Whether a token's `acr` and `auth_time` (seconds since the epoch) are a step-up still inside
 * the window at `now`: `auth_time` at most {@link STEP_UP_WINDOW_SECONDS} old and at most
 * {@link STEP_UP_CLOCK_SKEW_SECONDS} ahead.
 */
export function isFreshStepUp(
  token: { acr: string | null | undefined; authTime: number | null | undefined },
  now: Date | number,
): boolean {
  if (token.acr !== STEP_UP_ACR || typeof token.authTime !== 'number') return false;
  const age = (typeof now === 'number' ? now : now.getTime()) / 1000 - token.authTime;
  return age <= STEP_UP_WINDOW_SECONDS && age >= -STEP_UP_CLOCK_SKEW_SECONDS;
}
