import { Injectable, Logger } from '@nestjs/common';
import { canonicalJson } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';

import type { AuditSchema } from '../db/schema.js';
import { chainDayOf } from '../trail/chain.js';
import { auditAnchors, auditChainHeads } from '../trail/schema.js';
import { type ChainVerification, ChainVerifier } from '../trail/verifier.js';
import { AnchorArchive } from './archive.js';
import type { ChainRef } from './contract.js';
import { OpenBaoAnchorSigner } from './openbao-signer.js';

/** The anchor statement's version: what is signed is `canonicalJson` of `AnchorStatement`. */
export const ANCHOR_V = 1;

export interface AnchorStatement {
  v: number;
  tenant: string;
  chainDay: string;
  eventCount: number;
  headHash: string;
  merkleRoot: string;
}

export function anchorStatement(statement: Omit<AnchorStatement, 'v'>): string {
  return canonicalJson({ v: ANCHOR_V, ...statement });
}

export function anchorObjectKey({ tenant, chainDay }: ChainRef): string {
  return `anchors/${tenant}/${chainDay}.json`;
}

export type AnchorOutcome =
  | { status: 'anchored' | 'already-anchored' }
  | { status: 'tampered'; verification: ChainVerification };

/**
 * The daily anchors (ADR-008 Pipeline steps 5 and 6). A chain is anchored once its day has ended
 * (no event joins it after: events join the chain of the day they are recorded on): it is
 * verified first, a tampered chain is never anchored, then its Merkle root is signed with the
 * OpenBao key, archived in the `audit-archive` bucket and recorded. Verification of an anchored
 * chain also checks the anchor's signature.
 */
@Injectable()
export class Anchoring {
  private readonly logger = new Logger(Anchoring.name);

  constructor(
    @InjectDatabase() private readonly db: Database<AuditSchema>,
    private readonly verifier: ChainVerifier,
    private readonly signer: OpenBaoAnchorSigner,
    private readonly archive: AnchorArchive,
  ) {}

  /** The chains of days ended before `now` (UTC) that hold events and have no anchor yet. */
  async unanchoredChains(now: Date = new Date()): Promise<ChainRef[]> {
    const rows = await this.db
      .select({ tenant: auditChainHeads.tenant, chainDay: auditChainHeads.chainDay })
      .from(auditChainHeads)
      .leftJoin(
        auditAnchors,
        and(
          eq(auditAnchors.tenant, auditChainHeads.tenant),
          eq(auditAnchors.chainDay, auditChainHeads.chainDay),
        ),
      )
      .where(
        and(
          lt(auditChainHeads.chainDay, chainDayOf(now)),
          sql`${auditChainHeads.seq} > 0`,
          isNull(auditAnchors.tenant),
        ),
      )
      .orderBy(auditChainHeads.chainDay, auditChainHeads.tenant);
    return rows;
  }

  /** The anchored chains of the last `days` days before `now`, to verify again. */
  async anchoredChains(days: number, now: Date = new Date()): Promise<ChainRef[]> {
    const since = chainDayOf(new Date(now.getTime() - days * 86_400_000));
    return this.db
      .select({ tenant: auditAnchors.tenant, chainDay: auditAnchors.chainDay })
      .from(auditAnchors)
      .where(gte(auditAnchors.chainDay, since))
      .orderBy(auditAnchors.chainDay, auditAnchors.tenant);
  }

  async anchor(chain: ChainRef, now: Date = new Date()): Promise<AnchorOutcome> {
    if (chain.chainDay >= chainDayOf(now)) {
      throw new Error(`The chain of ${chain.chainDay} is still open`);
    }
    const verification = await this.verifier.verify(chain.tenant, chain.chainDay);
    if (verification.anchor.status !== 'none') return { status: 'already-anchored' };
    if (verification.status === 'tampered' || verification.merkleRoot === null) {
      this.logger.error(
        { chain, problems: verification.problems },
        'Audit chain tampered; not anchored',
      );
      return { status: 'tampered', verification };
    }
    const [head] = await this.db
      .select({ headHash: auditChainHeads.headHash })
      .from(auditChainHeads)
      .where(
        and(eq(auditChainHeads.tenant, chain.tenant), eq(auditChainHeads.chainDay, chain.chainDay)),
      );
    if (!head) throw new Error(`No chain head for ${chain.tenant} ${chain.chainDay}`);
    const fields = {
      tenant: chain.tenant,
      chainDay: chain.chainDay,
      eventCount: verification.events,
      headHash: head.headHash,
      merkleRoot: verification.merkleRoot,
    };
    const statement = anchorStatement(fields);
    const { signature, keyVersion } = await this.signer.sign(statement);
    const objectKey = anchorObjectKey(chain);
    await this.archive.put(
      objectKey,
      `${JSON.stringify(
        {
          statement: { v: ANCHOR_V, ...fields },
          signature: {
            algorithm: 'ed25519',
            key: this.signer.keyName,
            keyVersion,
            publicKey: await this.signer.publicKey(keyVersion),
            value: signature,
          },
        },
        null,
        2,
      )}\n`,
    );
    const inserted = await this.db
      .insert(auditAnchors)
      .values({ ...fields, keyName: this.signer.keyName, keyVersion, signature, objectKey })
      .onConflictDoNothing()
      .returning({ tenant: auditAnchors.tenant });
    return { status: inserted.length > 0 ? 'anchored' : 'already-anchored' };
  }

  /** Verifies a chain, and for an anchored one the anchor's signature too. */
  async verify(chain: ChainRef): Promise<ChainVerification> {
    const verification = await this.verifier.verify(chain.tenant, chain.chainDay);
    const [anchor] = await this.db
      .select()
      .from(auditAnchors)
      .where(and(eq(auditAnchors.tenant, chain.tenant), eq(auditAnchors.chainDay, chain.chainDay)));
    if (!anchor) return verification;
    const valid = await this.signer.verify(
      anchorStatement({
        tenant: anchor.tenant,
        chainDay: anchor.chainDay,
        eventCount: anchor.eventCount,
        headHash: anchor.headHash,
        merkleRoot: anchor.merkleRoot,
      }),
      anchor.signature,
      anchor.keyVersion,
    );
    if (valid) return verification;
    return {
      ...verification,
      status: 'tampered',
      problems: [...verification.problems, { kind: 'anchor-mismatch', seq: null }],
      anchor: { ...verification.anchor, status: 'mismatch' },
    };
  }
}
