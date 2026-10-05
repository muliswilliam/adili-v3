import { describe, expect, it } from 'vitest';

import { isDroppedConnection } from './sign-in.ts';

describe('isDroppedConnection', () => {
  it('finds a socket closed under the request anywhere in the cause chain', () => {
    const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    const error = new Error('parsing error occured', {
      cause: new Error('failed to parse "response" body as JSON', {
        cause: new TypeError('terminated', { cause: socket }),
      }),
    });
    expect(isDroppedConnection(error)).toBe(true);
  });

  it('leaves other failures alone, so a refused ticket is not retried', () => {
    expect(
      isDroppedConnection(new Error('demo sign-in: Keycloak answered 200 at /login instead')),
    ).toBe(false);
  });
});
