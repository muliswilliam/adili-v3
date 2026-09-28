import type { DirectoryError, RosterApiCredential } from '../../server/directory/client';
import { messages as m } from './messages';

/** What the API access page shows for the stored credential (spec 02, Screen: API access). */
export type CredentialState = 'none' | 'active' | 'revoked';

export function credentialState(credential: RosterApiCredential | null): CredentialState {
  if (!credential) return 'none';
  return credential.revokedAt ? 'revoked' : 'active';
}

export type CredentialAction = 'create' | 'rotate' | 'revoke';

/** How a failed create, rotate or revoke is told to the reporting officer. */
export type CredentialFailure =
  /** The session ended: sign in again and come back. */
  | { kind: 'sign-in' }
  /**
   * `message` says what happened. `stale`: the page no longer shows the directory's view (someone
   * created or revoked the credential meanwhile), so it reloads and the dialog, if any, closes.
   */
  | { kind: 'failed'; message: string; stale: boolean };

const RETRY: Record<CredentialAction, string> = {
  create: m.apiCreateError,
  rotate: m.apiRotateError,
  revoke: m.apiRevokeError,
};

export function credentialFailure(
  action: CredentialAction,
  error: DirectoryError,
): CredentialFailure {
  if (error.kind === 'unauthenticated') return { kind: 'sign-in' };
  if (error.kind === 'unavailable') return { kind: 'failed', message: RETRY[action], stale: false };
  const { problem } = error;
  if (problem.status === 403) return { kind: 'failed', message: m.apiForbidden, stale: false };
  if (action === 'create' && problem.status === 409) {
    return { kind: 'failed', message: m.apiAlreadyExists, stale: true };
  }
  if (action === 'rotate' && problem.type === 'api-credential-client-missing') {
    return { kind: 'failed', message: m.apiClientMissing, stale: false };
  }
  // No credential that is not revoked: someone revoked it meanwhile.
  if (action !== 'create' && problem.status === 404) {
    return { kind: 'failed', message: m.apiAlreadyRevoked, stale: true };
  }
  return { kind: 'failed', message: RETRY[action], stale: false };
}
