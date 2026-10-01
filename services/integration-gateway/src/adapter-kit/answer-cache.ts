import { Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectValkey } from '@adili/cache';
import type { Redis } from 'iovalkey';
import { z } from 'zod';

import type { RegistryAdapter } from './registry-adapter.js';

/** A registry answer worth reusing: the normalised data, or that the registry has no record. */
export type Answer<T> = { found: true; data: T } | { found: false };

/**
 * Registry answers in Valkey, keyed by system, operation and subject hash so identifiers never
 * appear in the keyspace. The cache only saves registry calls: when Valkey is down, reads miss
 * and writes are dropped.
 */
@Injectable()
export class AnswerCache {
  private readonly logger = new Logger(AnswerCache.name);

  constructor(@InjectValkey() private readonly valkey: Redis) {}

  async get<T>(adapter: RegistryAdapter<T>, subjectHash: string): Promise<Answer<T> | undefined> {
    let raw: string | null;
    try {
      raw = await this.valkey.get(key(adapter, subjectHash));
    } catch (error) {
      this.logger.warn(
        { system: adapter.system, errorType: errorType(error) },
        'Cache read failed; calling the registry',
      );
      return undefined;
    }
    if (raw === null) return undefined;
    const answer = answerSchema(adapter.schema).safeParse(parseJson(raw));
    // An entry of an older shape is a miss; the fresh answer overwrites it.
    return answer.success ? answer.data : undefined;
  }

  async set<T>(
    adapter: RegistryAdapter<T>,
    subjectHash: string,
    answer: Answer<T>,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.valkey.set(key(adapter, subjectHash), JSON.stringify(answer), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        { system: adapter.system, errorType: errorType(error) },
        'Cache write failed',
      );
    }
  }
}

const key = (adapter: RegistryAdapter<unknown>, subjectHash: string) =>
  `${adapter.system}:${adapter.operation}:${subjectHash}`;

function answerSchema<T>(data: z.ZodType<T>) {
  return z.discriminatedUnion('found', [
    z.object({ found: z.literal(true), data }),
    z.object({ found: z.literal(false) }),
  ]);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
