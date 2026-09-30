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
