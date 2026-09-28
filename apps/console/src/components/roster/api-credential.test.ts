import { describe, expect, it } from 'vitest';

import type { DirectoryError, RosterApiCredential } from '../../server/directory/client';
import { credentialFailure, credentialState } from './api-credential';
import { messages as m } from './messages';

const credential: RosterApiCredential = {
  clientId: 'roster-psc-3f9a2c1d',
  createdAt: '2026-09-22T06:41:00Z',
  createdBy: { id: 'sub-1', name: 'Grace Muthoni' },
  rotatedAt: null,
  revokedAt: null,
  lastUsedAt: null,
};

const problem = (status: number, type = 'about:blank'): DirectoryError => ({
  kind: 'problem',
  problem: { type, title: 'Problem', status },
});

describe('credentialState', () => {
  it('is none before any credential was created', () => {
    expect(credentialState(null)).toBe('none');
  });

  it('is active until revoked, rotated or not', () => {
    expect(credentialState(credential)).toBe('active');
    expect(credentialState({ ...credential, rotatedAt: '2026-09-24T08:00:00Z' })).toBe('active');
  });

  it('is revoked once revokedAt is set', () => {
    expect(credentialState({ ...credential, revokedAt: '2026-09-26T09:58:00Z' })).toBe('revoked');
  });
});

describe('credentialFailure', () => {
  it('sends the officer to sign in when the session ended', () => {
    expect(credentialFailure('create', { kind: 'unauthenticated' })).toEqual({ kind: 'sign-in' });
  });

  it.each([
    ['create', m.apiCreateError],
    ['rotate', m.apiRotateError],
    ['revoke', m.apiRevokeError],
  ] as const)('asks to retry a %s that failed on the way (network, 5xx)', (action, message) => {
    expect(credentialFailure(action, { kind: 'unavailable', detail: null })).toEqual({
      kind: 'failed',
      message,
      stale: false,
    });
  });

  it('asks to retry when the identity provider failed (502 identity-unavailable)', () => {
    const error: DirectoryError = {
      kind: 'unavailable',
      detail: null,
      problemType: 'identity-unavailable',
    };
    expect(credentialFailure('rotate', error)).toEqual({
      kind: 'failed',
      message: m.apiRotateError,
      stale: false,
    });
  });

  it('reloads the page when a credential was created meanwhile (409 on create)', () => {
    expect(credentialFailure('create', problem(409, 'api-credential-exists'))).toEqual({
      kind: 'failed',
      message: m.apiAlreadyExists,
      stale: true,
    });
  });

  it.each(['rotate', 'revoke'] as const)(
    'reloads the page when the credential was revoked meanwhile (404 on %s)',
    (action) => {
      expect(credentialFailure(action, problem(404))).toEqual({
        kind: 'failed',
        message: m.apiAlreadyRevoked,
        stale: true,
      });
    },
  );

  it('says to revoke and create again when the client is gone from Keycloak', () => {
    expect(credentialFailure('rotate', problem(409, 'api-credential-client-missing'))).toEqual({
      kind: 'failed',
      message: m.apiClientMissing,
      stale: false,
    });
  });

  it('explains a refusal (403) without reloading', () => {
    expect(credentialFailure('revoke', problem(403))).toEqual({
      kind: 'failed',
      message: m.apiForbidden,
      stale: false,
    });
  });

  it('falls back to retry for any other problem', () => {
    expect(credentialFailure('create', problem(404))).toEqual({
      kind: 'failed',
      message: m.apiCreateError,
      stale: false,
    });
  });
});
