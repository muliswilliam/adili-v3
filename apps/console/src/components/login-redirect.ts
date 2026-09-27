import { redirect } from '@tanstack/react-router';

/** Where to sign in, coming back to `returnTo` afterwards. */
export function loginHref(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Sends a signed-out user to sign in, then back to where they were. */
export function loginRedirect(returnTo: string) {
  return redirect({ href: loginHref(returnTo), reloadDocument: true });
}
