/**
 * Signing in again from the browser. `/auth/login` is a server route, so it is always a full
 * page load: on in-app navigation the browser router would render Not Found.
 */

/** The sign-in page, which sends the declarant back to `returnTo` afterwards. */
export function loginHref(returnTo: string) {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Signs the declarant in, then back to `returnTo` (this page by default). */
export function signInAgain(returnTo = window.location.pathname) {
  window.location.assign(loginHref(returnTo));
}

/**
 * The step-up page (spec 06): a fresh one-time code without the password, then back to
 * `returnTo` with `stepUp=done`, or `stepUp=failed` when it did not go through.
 */
export function stepUpHref(returnTo: string) {
  return `/auth/step-up?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Sends the declarant to confirm their identity with a new code, then back to `returnTo`. */
export function stepUp(returnTo = window.location.pathname) {
  window.location.assign(stepUpHref(returnTo));
}
