/** Human-readable text for `?auth_error=` codes set by the login callback. */
export function authErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case undefined:
      return null;
    case 'access_denied':
      return 'Sign-in was cancelled. You can try again whenever you are ready.';
    case 'login_expired':
      return 'Your sign-in attempt expired. Please sign in again.';
    default:
      return 'We could not sign you in. Please try again.';
  }
}
