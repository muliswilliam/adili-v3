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
