import { describe, expect, it } from 'vitest';

import {
  type ValkeyCommands,
  ValkeyActivationLookups,
} from '../../src/commissions/activation-lookups.js';

/** A Valkey stand-in that records SET options and can be made unavailable. */
function fakeValkey() {
  const values = new Map<string, string>();
  const sets: unknown[][] = [];
  let down = false;
  const guard = () => {
    if (down) return Promise.reject(new Error('connection refused'));
    return Promise.resolve();
  };
  const commands: ValkeyCommands = {
    async get(key) {
      await guard();
      return values.get(key) ?? null;
    },
    async set(key, value, mode, seconds) {
      await guard();
      sets.push([key, value, mode, seconds]);
      values.set(key, value);
      return 'OK';
    },
    async del(key) {
      await guard();
      return values.delete(key) ? 1 : 0;
    },
  };
  return {
    commands,
    sets,
    goDown: () => {
      down = true;
    },
  };
}

describe('ValkeyActivationLookups', () => {
  it('remembers a subject for five minutes under its own key', async () => {
    const valkey = fakeValkey();
    const lookups = new ValkeyActivationLookups(valkey.commands);

    expect(await lookups.knownNotInvited('user-1')).toBe(false);
    await lookups.rememberNotInvited('user-1');

    expect(await lookups.knownNotInvited('user-1')).toBe(true);
    expect(await lookups.knownNotInvited('user-2')).toBe(false);
    expect(valkey.sets).toEqual([['activation:not-invited:user-1', '1', 'EX', 300]]);
  });

  it('forgets a subject', async () => {
    const lookups = new ValkeyActivationLookups(fakeValkey().commands);
    await lookups.rememberNotInvited('user-1');

    await lookups.forget('user-1');

    expect(await lookups.knownNotInvited('user-1')).toBe(false);
  });

  it('reads as unknown and never throws while Valkey is unavailable', async () => {
    const valkey = fakeValkey();
    const lookups = new ValkeyActivationLookups(valkey.commands);
    await lookups.rememberNotInvited('user-1');
    valkey.goDown();

    expect(await lookups.knownNotInvited('user-1')).toBe(false);
    await expect(lookups.rememberNotInvited('user-1')).resolves.toBeUndefined();
    await expect(lookups.forget('user-1')).resolves.toBeUndefined();
  });
});
