import { createHash } from 'node:crypto';

import { canonicalJson } from '@adili/api-kit';
import type { EventEnvelope } from '@adili/events';

/**
 * The hash chain of ADR-008 (Pipeline step 4): `hash = SHA-256(prev_hash || canonical(event))`,
 * one chain per tenant per UTC day, so tenants and days append in parallel. The first event of a
 * chain links to `GENESIS_HASH`. The canonical form (RFC 8785, `canonicalJson`) is versioned (`HASH_V`): a change to it is a
 * new version, and events keep the version they were hashed with.
 */
export const HASH_V = 1;

/** What the first event of every chain links to. */
export const GENESIS_HASH = '0'.repeat(64);

/** The position of an event in the trail, hashed with it so it cannot move. */
export interface ChainPosition {
  tenant: string;
  chainDay: string;
  seq: number;
}

/** Hex SHA-256 of an event at `position` after `prevHash`, in hash version `HASH_V`. */
export function eventHash(
  prevHash: string,
  position: ChainPosition,
  envelope: EventEnvelope,
  hashV: number = HASH_V,
): string {
  if (hashV !== HASH_V) throw new Error(`Unknown audit hash version ${String(hashV)}`);
  const canonical = canonicalJson({
    v: hashV,
    tenant: position.tenant,
    chainDay: position.chainDay,
    seq: position.seq,
    envelope,
  });
  return sha256Hex(prevHash + canonical);
}

/**
 * The Merkle root of a chain's event hashes, in chain order: leaves and inner nodes are SHA-256
 * of their children's hex hashes, an odd node out is carried up as is. An empty chain has none.
 */
export function merkleRoot(hashes: readonly string[]): string {
  if (hashes.length === 0) throw new Error('A chain without events has no Merkle root');
  let level = hashes.map((hash) => sha256Hex(`leaf:${hash}`));
  while (level.length > 1) {
    const next: string[] = [];
    level.forEach((left, at) => {
      if (at % 2 === 1) return;
      const right = level[at + 1];
      next.push(right === undefined ? left : sha256Hex(`node:${left}${right}`));
    });
    level = next;
  }
  const [root] = level;
  if (root === undefined) throw new Error('unreachable: a non-empty level has a first node');
  return root;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** The UTC day (`YYYY-MM-DD`) of an instant: the chain an event occurring then belongs to. */
export function chainDayOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
