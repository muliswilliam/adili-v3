import { createEnvelope } from '@adili/events';
import { describe, expect, it } from 'vitest';

import { chainDayOf, eventHash, GENESIS_HASH, HASH_V, merkleRoot, sha256Hex } from './chain.js';

const envelope = createEnvelope('adili/declarations', {
  type: 'declaration.submitted.v1',
  tenant: 'psc',
  subject: '0192f1c4-0000-7000-8000-000000000001',
  data: { declarationId: '0192f1c4-0000-7000-8000-000000000001', version: 1 },
});
const position = { tenant: 'psc', chainDay: '2026-10-05', seq: 1 };

describe('eventHash', () => {
  it('is the same for the same event whatever the order of its keys', () => {
    // Keys in reverse order, as jsonb may hand them back.
    const reordered = Object.fromEntries(
      Object.entries(envelope).reverse(),
    ) as unknown as typeof envelope;
    expect(eventHash(GENESIS_HASH, position, reordered)).toBe(
      eventHash(GENESIS_HASH, position, envelope),
    );
  });

  it('changes with the previous hash, the place in the chain and the event', () => {
    const hash = eventHash(GENESIS_HASH, position, envelope);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eventHash(sha256Hex('other'), position, envelope)).not.toBe(hash);
    expect(eventHash(GENESIS_HASH, { ...position, seq: 2 }, envelope)).not.toBe(hash);
    expect(eventHash(GENESIS_HASH, { ...position, tenant: 'tsc' }, envelope)).not.toBe(hash);
    expect(eventHash(GENESIS_HASH, { ...position, chainDay: '2026-10-06' }, envelope)).not.toBe(
      hash,
    );
    expect(
      eventHash(GENESIS_HASH, position, { ...envelope, data: { ...envelope.data, version: 2 } }),
    ).not.toBe(hash);
  });

  it('refuses a hash version it does not know', () => {
    expect(() => eventHash(GENESIS_HASH, position, envelope, HASH_V + 1)).toThrow(/version/);
  });
});

describe('merkleRoot', () => {
  const leaf = (hash: string) => sha256Hex(`leaf:${hash}`);
  const node = (left: string, right: string) => sha256Hex(`node:${left}${right}`);

  it('is the leaf of a single event', () => {
    expect(merkleRoot(['a'])).toBe(leaf('a'));
  });

  it('pairs leaves and carries an odd one up', () => {
    expect(merkleRoot(['a', 'b', 'c'])).toBe(node(node(leaf('a'), leaf('b')), leaf('c')));
  });

  it('changes when an event is removed or reordered', () => {
    const root = merkleRoot(['a', 'b', 'c', 'd']);
    expect(merkleRoot(['a', 'b', 'd'])).not.toBe(root);
    expect(merkleRoot(['b', 'a', 'c', 'd'])).not.toBe(root);
  });

  it('refuses an empty chain', () => {
    expect(() => merkleRoot([])).toThrow();
  });
});

describe('chainDayOf', () => {
  it('is the UTC day', () => {
    expect(chainDayOf(new Date('2026-10-05T23:30:00+03:00'))).toBe('2026-10-05');
    expect(chainDayOf(new Date('2026-10-06T01:30:00+03:00'))).toBe('2026-10-05');
  });
});
