import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectValkey } from '@adili/cache';
import type { Redis } from 'iovalkey';

import type { IprsPerson } from './iprs-person.js';

export const IPRS_CACHE_TTL_SECONDS = Symbol('IPRS_CACHE_TTL_SECONDS');

/** An IPRS answer worth reusing: the person, or that IPRS has no record. */
export type IprsAnswer = { found: true; person: IprsPerson } | { found: false };

/**
 * IPRS answers in Valkey, keyed by subject hash so national IDs never appear in the keyspace.
 * The cache only saves registry calls: when Valkey is down, reads miss and writes are dropped.
 */
@Injectable()
export class IprsCache {
  private readonly logger = new Logger(IprsCache.name);

  constructor(
    @InjectValkey() private readonly valkey: Redis,
    @Inject(IPRS_CACHE_TTL_SECONDS) private readonly ttlSeconds: number,
  ) {}

  async get(subjectHash: string): Promise<IprsAnswer | undefined> {
    try {
      const raw = await this.valkey.get(key(subjectHash));
      return raw === null ? undefined : (JSON.parse(raw) as IprsAnswer);
    } catch (error) {
      this.logger.warn({ errorType: errorType(error) }, 'IPRS cache read failed; calling IPRS');
      return undefined;
    }
  }

  async set(subjectHash: string, answer: IprsAnswer): Promise<void> {
    try {
      await this.valkey.set(key(subjectHash), JSON.stringify(answer), 'EX', this.ttlSeconds);
    } catch (error) {
      this.logger.warn({ errorType: errorType(error) }, 'IPRS cache write failed');
    }
  }
}

const key = (subjectHash: string) => `iprs:person:${subjectHash}`;
