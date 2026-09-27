import { redirect } from '@tanstack/react-router';

/** Sends a signed-out user to the login flow, returning to `returnTo` (path and query) after. */
export function signInRedirect(returnTo: string) {
  return redirect({
    href: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    reloadDocument: true,
  });
}
