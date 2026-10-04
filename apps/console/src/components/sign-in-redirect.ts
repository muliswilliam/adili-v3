import { redirect } from '@tanstack/react-router';

/** The login flow's URL, returning to `returnTo` (path and query) after. */
export function signInUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Sends a signed-out user to the login flow, returning to `returnTo` (path and query) after. */
export function signInRedirect(returnTo: string) {
  return redirect({ href: signInUrl(returnTo), reloadDocument: true });
}

/** The page the browser shows, path and query, as sign-in should return to it. */
export function currentPage(): string {
  return window.location.pathname + window.location.search;
}

/**
 * Sends the browser to the login flow when the session has ended, returning to `returnTo` after:
 * by default the page it is on, query included.
 */
export function goToSignIn(returnTo: string = currentPage()): void {
  window.location.assign(signInUrl(returnTo));
}

/**
 * Sends the browser to confirm the officer's identity with a fresh one-time code (spec 06
 * step-up), then back to `returnTo` with `stepUp=done`, or `stepUp=failed` when it did not go
 * through. `/auth/step-up` is a server route, so it is always a full page load.
 */
export function goToStepUp(returnTo: string = currentPage()): void {
  window.location.assign(`/auth/step-up?returnTo=${encodeURIComponent(returnTo)}`);
}
