import { redirect } from '@tanstack/react-router';

/** Sends a signed-out user to sign in, then back to where they were. */
export function loginRedirect(returnTo: string) {
  return redirect({
    href: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    reloadDocument: true,
  });
}
